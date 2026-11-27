import { z } from 'zod';

const safeText = (max) => z.string().trim().max(max);

const strongPassword = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128)
  .regex(/[A-Z]/, 'Password requires an uppercase letter')
  .regex(/[a-z]/, 'Password requires a lowercase letter')
  .regex(/[0-9]/, 'Password requires a number')
  .regex(/[^A-Za-z0-9]/, 'Password requires a special character');

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform((v) => v.toLowerCase()),
  password: strongPassword
}).strict();

export const adminCreateUserSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform((v) => v.toLowerCase()),
  password: strongPassword,
  role: z.enum(['admin', 'staff']).default('staff')
}).strict();

export const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(128)
}).strict();

export const itemCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(160),
  category_id: z.union([z.number().int().positive(), z.null()]).optional(),
  quantity: z.number().int().min(0).max(1000000).default(0),
  threshold: z.number().int().min(0).max(1000000).default(5),
  unit_price: z.number().min(0).max(10000000).default(0),
  unit: safeText(32).default('pcs'),
  sku: safeText(64).default(''),
  description: safeText(1000).default(''),
  auto_qr: z.boolean().default(true)
}).strict();

export const itemUpdateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  category_id: z.union([z.number().int().positive(), z.null()]).optional(),
  quantity: z.number().int().min(0).max(1000000).optional(),
  threshold: z.number().int().min(0).max(1000000).optional(),
  unit_price: z.number().min(0).max(10000000).optional(),
  unit: safeText(32).optional(),
  sku: safeText(64).optional(),
  description: safeText(1000).optional()
}).strict();

export const quantityDeltaSchema = z.object({
  amount: z.number().int().min(1).max(100000).default(1),
  notes: safeText(240).optional()
}).strict();

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').max(100),
  description: safeText(300).default(''),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex color').default('#0ea5e9')
}).strict();

export const qrVerifySchema = z.object({
  payload: z.string().trim().min(1).max(2048)
}).strict();

export const vehicleCreateSchema = z.object({
  plate_number: z.string().trim().min(2, 'Plate number is required').max(32),
  model: z.string().trim().min(1, 'Model is required').max(120),
  cargo_type: z.string().trim().min(1, 'Cargo type is required').max(80),
  capacity_cubic_m: z.number().positive('Capacity must be greater than 0').max(100000),
  current_load_pct: z.number().int().min(0).max(100).default(0),
  status: z.enum(['available', 'assigned', 'service_needed']).default('available'),
  last_service_date: z.union([z.string().trim().min(1).max(64), z.null()]).optional()
}).strict();

export const vehicleUpdateSchema = z.object({
  plate_number: z.string().trim().min(2).max(32).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  cargo_type: z.string().trim().min(1).max(80).optional(),
  capacity_cubic_m: z.number().positive().max(100000).optional(),
  current_load_pct: z.number().int().min(0).max(100).optional(),
  status: z.enum(['available', 'assigned', 'service_needed']).optional(),
  last_service_date: z.union([z.string().trim().min(1).max(64), z.null()]).optional()
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided'
});

export const deliveryCreateSchema = z.object({
  tracking_code: z.string().trim().min(3).max(64).optional(),
  vehicle_id: z.number().int().positive('Vehicle is required'),
  item_id: z.number().int().positive('Item is required'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1').max(1000000),
  origin: z.string().trim().min(2, 'Origin is required').max(160),
  destination: z.string().trim().min(2, 'Destination is required').max(160),
  eta: z.union([z.string().trim().min(1).max(64), z.null()]).optional()
}).strict();

export const deliveryStatusUpdateSchema = z.object({
  status: z.enum(['pending', 'in_transit', 'delivered', 'delayed'])
}).strict();

export function parseBody(schema, req, res) {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({
      error: result.error.issues[0]?.message || 'Validation failed',
      details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    });
    return null;
  }
  return result.data;
}
