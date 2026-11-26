.PHONY: up down logs clean-python purge-history k8s-deploy verify-security

up:
	./scripts/setup-all.sh

down:
	docker compose down

logs:
	docker compose logs -f

clean-python:
	./scripts/purge-git-python.sh

purge-history:
	./scripts/purge-git-python.sh --rewrite-history

k8s-deploy:
	./scripts/deploy-k8s.sh $(REGISTRY) $(TAG)

verify-security:
	@test "$$(find . -type f -name '*.py' -not -path './.git/*' | wc -l | tr -d ' ')" -eq 0 && echo "[OK] 0 .py files"
	@docker compose ps
