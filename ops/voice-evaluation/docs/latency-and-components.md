# Latency issues and component choices

The problem is accumulated delay: endpoint detection, transcription, model/tool work, speech synthesis, buffering and playback. Timing only one HTTP chunk cannot explain the whole pause.

| Issue | Component or technique | Why it belongs | How to check it |
| --- | --- | --- | --- |
| The caller waits through a serial audio → text → model → audio chain | Streaming speech transport and incremental generation where supported | Starts useful output before the full response finishes | Speech-end → playback and first-audio-byte as separate metrics |
| Every turn repeats discovery/setup | Schema/tool-list cache | Reuses metadata instead of repeating discovery | Cold/warm lookup time, hit/miss count, version invalidation |
| Model lacks task-specific knowledge | RAG with authorized sources; optional Kong AI RAG Injector | Supplies retrieved evidence at the gateway boundary | Recall@k, citation membership, task correctness and added retrieval time |
| Repeated eligible questions regenerate the same answer | Optional Kong AI Semantic Cache | Reuses answers by semantic similarity | Hit/miss latency plus false-match, freshness and isolation tests |
| A fast answer may still be wrong or ignore a correction | Evaluation and tuning harness | Keeps task/context quality as gates while comparing latency | Calibration selection followed by a held-out check |

Schema caching stores metadata; semantic caching stores answers. Neither proves that a caller is allowed to see data. A retrieval hit is not permission, and an acknowledgment is not proof that an action completed.

The code here measures these distinctions. Kong configuration and live improvements remain to be demonstrated in the target application; the synthetic fixtures are not historical production results.
