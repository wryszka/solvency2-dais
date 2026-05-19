# Make targets for the Solvency II demo.

.PHONY: help cue-cards.pdf preflight bake-cache deploy-dev deploy-serverless app-start app-stop

help:
	@echo "  make cue-cards.pdf   — render docs/cue_cards.md to PDF (requires pandoc)"
	@echo "  make preflight       — run scripts/preflight_check.sh"
	@echo "  make bake-cache      — pre-bake AI outputs into 6_ai_demo_cache"
	@echo "  make deploy-dev      — bundle deploy + app deploy to the dev target"
	@echo "  make app-start       — start the Databricks App (resumes DBU billing)"
	@echo "  make app-stop        — stop the Databricks App (no DBU while stopped)"

app-start:
	databricks apps start solvency2-workbench --profile DEV

app-stop:
	databricks apps stop solvency2-workbench --profile DEV

cue-cards.pdf: docs/cue_cards.md
	@command -v pandoc >/dev/null || { echo "pandoc not installed — install with 'brew install pandoc' (and a TeX engine like basictex/mactex)."; exit 1; }
	pandoc docs/cue_cards.md -o cue-cards.pdf \
	    --pdf-engine=xelatex \
	    -V geometry:a5paper -V geometry:margin=1.5cm \
	    -V mainfont="Helvetica" -V monofont="Menlo" \
	    --highlight-style tango
	@echo "Wrote cue-cards.pdf"

preflight:
	./scripts/preflight_check.sh

bake-cache:
	./scripts/bake_cache.sh

deploy-dev:
	databricks bundle deploy -t dev --profile DEV
	@# Resolve app.yaml template variables — Databricks Apps does not
	@# interpret $${var.X} in app.yaml env values; we substitute before
	@# `apps deploy` so the running app has actual catalog/schema/warehouse.
	@TMPYAML=$$(mktemp); \
	  sed \
	    -e 's|$${var.catalog_name}|lr_dev_aws_us_catalog|g' \
	    -e 's|$${var.schema_name}|solvency2_workbench|g' \
	    -e 's|$${var.warehouse_id}|a3b61648ea4809e3|g' \
	    -e 's|$${var.app_display_name}|Actuarial Workbench|g' \
	    -e 's|$${var.dashboard_id}||g' \
	    -e 's|$${var.genie_space_id}||g' \
	    -e 's|$${var.backstage_notebook_path}||g' \
	    -e 's|$${var.pricing_app_url}|https://pricing-workbench-7474656169654171.aws.databricksapps.com/|g' \
	    -e 's|$${var.fm_model_endpoints}||g' \
	    -e 's|$${var.supervisor_endpoint_name}|workbench-supervisor|g' \
	    -e "s|\$${var.bundle_files_root}|/Workspace/Users/$$USER@databricks.com/.bundle/solvency2_workbench/dev/files|g" \
	    src/app/app.yaml > $$TMPYAML; \
	  databricks workspace import \
	    "/Workspace/Users/$$USER@databricks.com/.bundle/solvency2_workbench/dev/files/src/app/app.yaml" \
	    --format AUTO --file $$TMPYAML --overwrite --profile DEV; \
	  rm -f $$TMPYAML
	databricks apps deploy solvency2-workbench \
	    --source-code-path "/Workspace/Users/$$USER@databricks.com/.bundle/solvency2_workbench/dev/files/src/app" \
	    --profile DEV

deploy-serverless:
	databricks bundle deploy -t serverless --profile sfevm
	@TMPYAML=$$(mktemp); \
	  sed \
	    -e 's|$${var.catalog_name}|lr_serverless_aws_us_catalog|g' \
	    -e 's|$${var.schema_name}|solvency2_workbench|g' \
	    -e 's|$${var.warehouse_id}|ab79eced8207d29b|g' \
	    -e 's|$${var.app_display_name}|Actuarial Workbench|g' \
	    -e 's|$${var.dashboard_id}||g' \
	    -e 's|$${var.genie_space_id}||g' \
	    -e 's|$${var.backstage_notebook_path}||g' \
	    -e 's|$${var.pricing_app_url}||g' \
	    -e 's|$${var.fm_model_endpoints}||g' \
	    -e 's|$${var.supervisor_endpoint_name}|workbench-supervisor|g' \
	    -e "s|\$${var.bundle_files_root}|/Workspace/Users/$$USER@databricks.com/.bundle/solvency2_workbench/serverless/files|g" \
	    src/app/app.yaml > $$TMPYAML; \
	  databricks workspace import \
	    "/Workspace/Users/$$USER@databricks.com/.bundle/solvency2_workbench/serverless/files/src/app/app.yaml" \
	    --format AUTO --file $$TMPYAML --overwrite --profile sfevm; \
	  rm -f $$TMPYAML
	@# Ensure the app exists (create if not), then deploy code
	@databricks apps get solvency2-workbench --profile sfevm >/dev/null 2>&1 || \
	  databricks apps create solvency2-workbench --description "Actuarial Workbench" --profile sfevm
	databricks apps deploy solvency2-workbench \
	    --source-code-path "/Workspace/Users/$$USER@databricks.com/.bundle/solvency2_workbench/serverless/files/src/app" \
	    --profile sfevm
