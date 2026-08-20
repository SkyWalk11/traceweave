.PHONY: install dev backend frontend mock-trace stop

install:
	cd backend && npm install
	cd frontend && npm install
	test -f backend/.env || cp backend/.env.example backend/.env
	test -f frontend/.env || cp frontend/.env.example frontend/.env

dev:
	@trap 'kill 0' EXIT INT TERM; \
	(cd backend && npm run dev) & \
	(cd frontend && npm run dev) & \
	wait

backend:
	cd backend && npm run dev

frontend:
	cd frontend && npm run dev

mock-trace:
	cd backend && npm run mock-trace

# safety net if a previous `make dev` didn't shut down cleanly
stop:
	-pkill -f "tsx watch --env-file=.env src/server.ts"
	-pkill -f "frontend/node_modules/.bin/vite"
