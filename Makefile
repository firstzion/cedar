# Common commands. Run from the repo root.
COMPOSE = docker compose --env-file .env -f docker/compose.yaml
WAIT = echo 'waiting for Haxall...'; until [ "$$(docker inspect -f '{{.State.Health.Status}}' skyspark_lite_haxall)" = "healthy" ]; do sleep 2; done; sleep 12

.PHONY: build up down logs reset status check-env
build:  ## build the Haxall image (slow the first time)
	$(COMPOSE) build
check-env: ## stop early if .env is missing, or still has the example password when a new database would be created
	@test -f .env || { echo 'No .env file yet. Run: cp .env.example .env  then set HAXALL_SU_PASSWORD to a password of your own.'; exit 1; }
	@db=$$(sed -n 's/^HAXALL_DB_NAME=//p' .env | tail -n 1 | tr -d '\r'); db=$${db:-demo}; \
	 if grep -qE '^HAXALL_SU_PASSWORD=change-me[[:space:]]*$$' .env && [ -z "$$(ls -A "dbs/$$db" 2>/dev/null)" ]; then \
	   echo 'HAXALL_SU_PASSWORD in .env is still the example "change-me". Set a password of your own, then run make up again.'; exit 1; \
	 fi
up: check-env ## start Haxall, then load the demo data if it is missing (history is lost on restart)
	$(COMPOSE) up -d --build
	@$(WAIT)
	npm run -s demo:ensure
down:   ## stop Haxall (data is kept)
	$(COMPOSE) down
logs:   ## follow Haxall logs
	$(COMPOSE) logs -f haxall
status: ## show container state
	$(COMPOSE) ps
reset:  ## DELETE the Haxall database and start fresh (demo data is reloaded)
	$(COMPOSE) down
	rm -rf dbs
	mkdir -p dbs
	$(MAKE) up

.PHONY: install axon spike
install: ## install Node dependencies
	npm install
axon:    ## run one Axon expression:  make axon E='libs()'
	cd packages/haystack && npm run -s axon -- '$(E)'
spike:   ## check login + about + eval against the running Haxall
	npm run -s spike

.PHONY: specs test
specs:   ## reload Xeto specs (restarts Haxall) and check the ats lib compiles
	docker restart skyspark_lite_haxall > /dev/null
	@$(WAIT)
	node --env-file=.env --experimental-strip-types tools/validate/check-lib.ts
	npm run -s demo:ensure
test:    ## run all tests (Haxall must be running)
	npx vitest run
	npm run -s typecheck -w @ssl/ui
	node --env-file=.env --experimental-strip-types --test --test-concurrency=1 "tools/**/*.test.ts"

.PHONY: load demo-reset
load:    ## wipe and reload the demo site and histories (SEED=42 to change the data)
	npm run -s demo:load -- --reset --seed $(or $(SEED),42)
demo-reset: ## remove the demo data only
	npm run -s demo:reset

.PHONY: ui build-ui
ui:      ## start the web app (http://localhost:5173); needs Haxall running
	npm run dev -w @ssl/ui
build-ui: ## production build of the web app into ui/dist
	npm run build -w @ssl/ui

.PHONY: screenshots
screenshots: ## retake the README screenshots (needs Haxall and `make ui` running, and Chrome/Brave/Edge)
	node --env-file=.env --experimental-strip-types tools/screenshots/capture.ts
