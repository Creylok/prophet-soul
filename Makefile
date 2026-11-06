.PHONY: js test ci run

js:            ## build src/prophet_soul/omniscient.js from web/
	cd web && npm ci --no-audit --no-fund && npm run build

test:
	cd web && node --test
	uv run pytest

ci: test
	uv run ruff check .
	uv run ruff format --check .

run:
	uv run prophet-soul
