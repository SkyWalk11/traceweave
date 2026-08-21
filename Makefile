.PHONY: install dev backend frontend mock-trace stop

install:
	cd backend && bun install
	cd frontend && bun install
	test -f backend/.env || cp backend/.env.example backend/.env
	test -f frontend/.env || cp frontend/.env.example frontend/.env

dev:
	@trap 'kill 0' EXIT INT TERM; \
	(cd backend && bun run dev) & \
	(cd frontend && bun run dev) & \
	wait

backend:
	cd backend && bun run dev

frontend:
	cd frontend && bun run dev

mock-trace:
	cd backend && bun run mock-trace

# safety net if a previous `make dev` didn't shut down cleanly
stop:
	-pkill -f "bun --watch --env-file=.env src/server.ts"
	-pkill -f "frontend/node_modules/.bin/vite"
