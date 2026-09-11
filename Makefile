.PHONY: leaf-jsonld-workflow

leaf-jsonld-workflow:
	@if [ -z "$(ARGS)" ]; then \
		echo "usage: make leaf-jsonld-workflow ARGS=\"--jsonld path/to/graph.jsonld [--graph-out path/to/graph.json] [--input path/to/input.json] [--skip-run]\""; \
		exit 2; \
	fi
	node .agents/skills/leaf/scripts/leaf-jsonld-workflow.mjs $(ARGS)
