# Kong RAG and caching: optional integration plan

The [AI RAG Injector plugin](https://developer.konghq.com/plugins/ai-rag-injector/) retrieves vector-store context and injects it into a model prompt. The [AI Semantic Cache plugin](https://developer.konghq.com/plugins/ai-semantic-cache/) caches model responses using semantic matching. These are distinct from an application's schema/tool-list cache. The plugin pages identify AI Gateway Enterprise licensing; RAG Injector lists Gateway 3.10+ and Semantic Cache 3.8+. Validate the exact deployed version's configuration; newer AI Gateway policies have a different configuration surface.

This repository does **not** deploy Kong. No placeholder YAML is presented as working infrastructure.

## Wiring a real experiment

1. On a licensed test gateway, configure an AI model route and RAG Injector against an authorized, versioned test corpus. Use the deployed version's [RAG configuration reference](https://developer.konghq.com/plugins/ai-rag-injector/reference/).
2. Record ranked retrieved document IDs and the source revisions from gateway/retrieval instrumentation. A generated answer alone does not expose what was retrieved; do not fabricate these IDs from its prose.
3. Capture those IDs in `retrieval` cases, with independently labelled relevance and citations. Evaluate answer/task correctness separately.
4. Compare uncached, schema-cache-only, RAG and RAG-plus-semantic-cache configurations using the same frozen scenarios. Keep cold/miss and warm/hit results separate.
5. Before answer reuse, test similar questions requiring different answers, corrected conversation context, different authenticated scopes and source revisions. Personalized family data should bypass a shared answer cache until isolation and freshness are demonstrated.

The [semantic-cache reference](https://developer.konghq.com/plugins/ai-semantic-cache/reference/) exposes TTL, history countback and cache-control options. Their presence is not proof of tenant isolation. Do not assume “exact caching” disables all semantic matches; consult the plugin's documented behavior. No cache may replace FridgeGraph's live field authorization or parent confirmation.

`schema_cache.SchemaCache` is a local helper for metadata only, keyed by trusted scope/name/revision. FridgeGraph already has its own TypeScript tool-list/context caches; importing this harness does not replace those caches or route its model traffic through Kong.
