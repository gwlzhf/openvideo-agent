Display adapters for framework runtime modules (Next.js here). Map them in integration.config.mjs only when the
mounted components import them. They are static: the film never navigates, optimizes images or lazy-loads panels.
Write equivalents for other frameworks (router hooks, i18n loaders, IPC bridges) as the components require.
