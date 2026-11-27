-- Migration: 002_add_vehicles_and_deliveries
-- Fleet vehicles and active delivery shipment tracking

CREATE TABLE IF NOT EXISTS vehicles (
  id SERIAL PRIMARY KEY,
  plate_number VARCHAR(32) NOT NULL UNIQUE,
  model VARCHAR(120) NOT NULL,
  cargo_type VARCHAR(80) NOT NULL,
  capacity_cubic_m NUMERIC(10, 3) NOT NULL CHECK (capacity_cubic_m > 0),
  current_load_pct INTEGER NOT NULL DEFAULT 0 CHECK (current_load_pct >= 0 AND current_load_pct <= 100),
  status VARCHAR(24) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'assigned', 'service_needed')),
  last_service_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deliveries (
  id SERIAL PRIMARY KEY,
  tracking_code VARCHAR(64) NOT NULL UNIQUE,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  origin VARCHAR(160) NOT NULL,
  destination VARCHAR(160) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_transit', 'delivered', 'delayed')),
  eta TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicles_status_created
  ON vehicles (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deliveries_status_vehicle
  ON deliveries (status, vehicle_id);

DO $$
DECLARE
  v1 INTEGER;
  v2 INTEGER;
  v3 INTEGER;
  i1 INTEGER;
  i2 INTEGER;
  i3 INTEGER;
  i4 INTEGER;
  i5 INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vehicles) THEN
    INSERT INTO vehicles (plate_number, model, cargo_type, capacity_cubic_m, current_load_pct, status, last_service_date)
    VALUES
      ('B 9011 XYP', 'Daihatsu Luxio', 'Medium Truck', 336.548, 72, 'assigned', NOW() - INTERVAL '14 days'),
      ('B 4820 KTR', 'Isuzu Elf NLR', 'Box Van', 412.250, 65, 'assigned', NOW() - INTERVAL '21 days'),
      ('D 1945 VMP', 'Mitsubishi Colt Diesel', 'Heavy Carrier', 580.000, 84, 'assigned', NOW() - INTERVAL '9 days'),
      ('B 7731 ZQA', 'Suzuki Carry Blind Van', 'Light Van', 195.400, 0, 'available', NOW() - INTERVAL '7 days'),
      ('F 3092 HJN', 'Hino Dutro 130 HDL', 'Refrigerated', 460.800, 0, 'available', NOW() - INTERVAL '30 days'),
      ('B 6154 LWD', 'Toyota HiAce Cargo', 'Service Van', 240.125, 0, 'service_needed', NOW() - INTERVAL '95 days');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM deliveries) THEN
    SELECT id INTO v1 FROM vehicles WHERE plate_number = 'B 9011 XYP' LIMIT 1;
    SELECT id INTO v2 FROM vehicles WHERE plate_number = 'B 4820 KTR' LIMIT 1;
    SELECT id INTO v3 FROM vehicles WHERE plate_number = 'D 1945 VMP' LIMIT 1;

    SELECT id INTO i1 FROM items WHERE is_deleted = FALSE ORDER BY id ASC LIMIT 1 OFFSET 0;
    SELECT id INTO i2 FROM items WHERE is_deleted = FALSE ORDER BY id ASC LIMIT 1 OFFSET 1;
    SELECT id INTO i3 FROM items WHERE is_deleted = FALSE ORDER BY id ASC LIMIT 1 OFFSET 2;
    SELECT id INTO i4 FROM items WHERE is_deleted = FALSE ORDER BY id ASC LIMIT 1 OFFSET 3;
    SELECT id INTO i5 FROM items WHERE is_deleted = FALSE ORDER BY id ASC LIMIT 1 OFFSET 4;

    IF v1 IS NOT NULL AND v2 IS NOT NULL AND v3 IS NOT NULL AND i1 IS NOT NULL THEN
      INSERT INTO deliveries (tracking_code, vehicle_id, item_id, quantity, origin, destination, status, eta)
      VALUES
        ('TRK-88410', v1, i1, 10, 'Central Hub A', 'Jakarta North Depot', 'in_transit', NOW() + INTERVAL '6 hours'),
        ('TRK-88411', v2, COALESCE(i2, i1), 4, 'Central Hub A', 'Bandung Fulfillment', 'pending', NOW() + INTERVAL '1 day'),
        ('TRK-88412', v3, COALESCE(i3, i1), 8, 'West Dock B', 'Surabaya Port Terminal', 'in_transit', NOW() + INTERVAL '18 hours'),
        ('TRK-88413', v1, COALESCE(i4, i1), 12, 'South Annex', 'Bekasi Industrial Park', 'delayed', NOW() + INTERVAL '10 hours'),
        ('TRK-88414', v2, COALESCE(i5, i1), 20, 'Central Hub A', 'Tangerang Retail DC', 'pending', NOW() + INTERVAL '2 days');
    END IF;
  END IF;
END $$;
