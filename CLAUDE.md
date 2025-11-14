# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

QMesh v2 is a **distributed peer-to-peer LLM inference network** that enables consumer devices to share computational resources for running large language models. The system uses a credit-based priority queue to incentivize contribution while maintaining fair access.

**Current Status:** Pre-implementation phase. Complete architecture and implementation plans exist in [docs/](docs/), but no production code has been written yet.

## Core Architecture

### Three-Network P2P System

The system uses **three separate Hyperswarm networks**:

1. **Inference Network** (`qmesh-inference-v2`)
   - Client requests and worker responses
   - Participants: Clients + Workers
   - Messages: status, prompt, response, queue-status

2. **Score Network** (`qmesh-scores-v2`)
   - Score synchronization and verification across workers
   - Participants: Workers only
   - Messages: score-update, score-request, score-verify
   - Prevents score manipulation through network consensus

3. **Model Network** (`qmesh-models-v2`)
   - Distributed model storage via Hypercore/Hyperdrive
   - Content-addressed chunks with automatic verification
   - Multi-peer downloads for faster distribution

### Request Flow Architecture

```
Client → Network Discovery → Worker Selection → Priority Queue → Inference → Response
```

**Worker Selection Algorithm** (three-tier):
- Tier 1: Always prefer workers with **empty queues** (queue = 0)
- Tier 2: If all idle, select by **health score** (70%) + response time (30%)
- Tier 3: If all busy, select by **queue availability** (60%) + health (30%) + performance (10%)

### Priority Queue System

Requests are prioritized using a **6-tier credit system**:
- 👑 Master (10,000+): Instant processing
- 💎 Diamond (4,000-9,999): ~100ms wait
- 🏆 Platinum (1,500-3,999): ~500ms wait
- 🥇 Gold (500-1,499): ~1,000ms wait
- 🥈 Silver (100-499): ~2,000ms wait
- 🥉 Bronze (1-99): ~5,000ms wait

Within each tier, requests use **FIFO ordering**. Workers earn credits by processing requests; clients spend credits to submit requests.

### Score Calculation

Workers earn 0-10 points per request based on:
- **Speed Score** (0-5 points): Response time buckets
- **Complexity Score** (0-3 points): Prompt length / 50
- **Quality Score** (0-2 points): Success + result length

**Achievement bonuses** provide one-time score boosts (e.g., "Speed Demon" for 10 requests under 2s = +20 points).

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Inference** | node-llama-cpp | Local LLM execution (1.8x faster than Ollama) |
| **P2P Network** | Hyperswarm | Peer discovery and messaging |
| **Model Distribution** | Hypercore/Hyperdrive | Decentralized model sharing |
| **Score Persistence** | Hyperbee | Local score database |
| **Model Format** | GGUF | Quantized models (Q4_0, Q4_K_M, etc.) |
| **GPU Acceleration** | Metal/CUDA/Vulkan | Auto-detected hardware acceleration |

## Development Commands

**Note:** These commands are planned but not yet implemented. Refer to [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) for the full specification.

```bash
# Development
npm run dev                  # Start worker in development mode
npm start                    # Start worker in production mode

# Testing
npm test                     # Run all tests (Vitest)
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests only
npm run test:coverage       # Run tests with coverage

# Code Quality
npm run lint                # Lint code (ESLint)
npm run format              # Format code (Prettier)

# Model Management
npm run download-models     # Download GGUF models from Hugging Face
npm run benchmark           # Run performance benchmarks
npm run clean              # Cleanup databases and logs
```

## Project Structure

```
src/
├── worker/                 # Worker node implementation
│   ├── worker-node.js     # Main orchestrator - coordinates all worker subsystems
│   ├── model-loader.js    # GGUF model loading with GPU auto-detection
│   ├── inference-engine.js # LLM inference with streaming support
│   └── request-processor.js # Queue processing and score updates
├── client/                 # Client SDK
│   ├── qmesh-client.js    # Main client interface
│   ├── worker-selector.js  # Intelligent worker selection (3-tier algorithm)
│   └── streaming-client.js # Enhanced client with streaming
├── lib/                    # Shared libraries
│   ├── network-manager.js  # Hyperswarm P2P networking abstraction
│   ├── priority-queue.js   # Binary-search priority queue with FIFO
│   ├── score-manager.js    # Local score calculation and achievements
│   ├── global-score-manager.js # Network-wide score sync and verification
│   ├── score-db.js        # Hyperbee persistence layer
│   ├── system-monitor.js   # CPU/memory/load monitoring with health scores
│   └── model-distribution.js # P2P model sharing via Hyperdrive
└── config/
    └── default.js         # Configuration (network topics, inference params, etc.)
```

## Key Implementation Patterns

### Message Protocol

All P2P messages use **length-prefixed JSON**:
```
[4-byte length (big-endian)] + [JSON message bytes]
```

Messages are typed (`status`, `prompt`, `inference_result`, etc.) and include request IDs for correlation.

### GPU Detection Strategy

Models are loaded with automatic GPU detection:
- macOS (ARM64): Assume Metal, use 33 layers
- Linux/Windows: Check for `nvidia-smi`, use CUDA if available
- Fallback: CPU-only mode (0 GPU layers)

Override with environment variable: `GPU_LAYERS=-1` (auto) or `GPU_LAYERS=0` (CPU only)

### Context Management

The InferenceEngine creates **context pools** to support parallel inference. Each context has:
- A LlamaChatSession for maintaining conversation state
- Busy/available status tracking
- Request count metrics

Contexts are reused across requests but never shared simultaneously.

### Health-Based Load Management

Workers calculate a **health score (0-100)** based on:
- CPU usage (30% weight)
- Memory usage (30% weight)
- Load average (20% weight)
- Queue fullness (20% weight)

Health states determine capacity:
- 🟢 Idle (80-100): 100% capacity
- 🟢 Light (60-80): 80% capacity
- 🟡 Moderate (40-60): 60% capacity
- 🟠 Busy (20-40): 40% capacity
- 🔴 Overloaded (0-20): 0% capacity (reject new requests)

## Important Development Notes

### Model Files
- Models are **not committed to git** (stored in `models/` directory)
- Use quantized GGUF models (Q4_0 or Q4_K_M recommended)
- Start with 1B models for testing, scale to 7B/13B for production
- Download from Hugging Face: `https://huggingface.co/models?library=gguf`

### Worker IDs
- Each worker generates a persistent ID on first run (stored in `worker-id.txt`)
- IDs are 64-character hex strings (32 random bytes)
- Never commit `worker-id.txt` to version control

### Score Database
- Stored in `score-db/` directory (gitignored)
- Uses Hyperbee (append-only log)
- Compact periodically to prevent unbounded growth
- Backup before major changes

### Error Handling
- Always use try/catch for async inference operations
- Return structured error responses with `type: 'inference_error'`
- Log errors but avoid exposing internal details to clients
- Implement exponential backoff for network retries

### Testing Strategy
- **Unit tests:** Priority queue, score calculations, worker selection logic
- **Integration tests:** End-to-end inference, multi-worker coordination, score sync
- **Performance tests:** Latency benchmarks, throughput under load, memory profiling
- **Stress tests:** High concurrent requests, network interruptions, worker failures

## Implementation Timeline

Reference [docs/IMPLEMENTATION_GUIDE.md](docs/IMPLEMENTATION_GUIDE.md) for the complete 7-phase plan:

1. **Phase 1** (3-5 days): Core inference engine with node-llama-cpp
2. **Phase 2** (5-7 days): P2P networking with Hyperswarm
3. **Phase 3** (4-6 days): Priority queue and scoring system
4. **Phase 4** (5-7 days): Model distribution via Hypercore
5. **Phase 5** (3-4 days): System monitoring and health checks
6. **Phase 6** (4-5 days): Client SDK with worker selection
7. **Phase 7** (5-7 days): Testing, optimization, and deployment

**Total:** 4-6 weeks for a single developer

## Performance Expectations

**M1 MacBook Pro (8GB RAM):**
- Model load: 3-5 seconds
- Inference (1B): 50-80 tokens/sec (Metal GPU)
- Memory: ~1.5GB
- Throughput: ~100 req/hour

**Desktop (16GB RAM, NVIDIA RTX 3060):**
- Model load: 2-3 seconds
- Inference (7B): 100-150 tokens/sec (CUDA GPU)
- Memory: ~5-8GB
- Throughput: ~200 req/hour

**Network Scalability:**
- 10 workers: ~1,000 requests/hour
- 100 workers: ~10,000 requests/hour
- 1,000 workers: ~100,000 requests/hour

## Documentation

All architectural documentation is in [docs/](docs/):
- **[NEW_ARCHITECTURE.md](docs/NEW_ARCHITECTURE.md)**: Complete system design (READ FIRST)
- **[IMPLEMENTATION_GUIDE.md](docs/IMPLEMENTATION_GUIDE.md)**: Step-by-step build guide with code examples
- **[API_SPECIFICATION.md](docs/API_SPECIFICATION.md)**: Complete API reference
- **[PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md)**: Codebase organization and conventions
- **[QMESH_V2_SUMMARY.md](docs/QMESH_V2_SUMMARY.md)**: Quick reference overview

## Security Considerations

### Score Verification
- Workers cross-reference scores via the Score Network
- Multiple workers must confirm scores (consensus-based)
- Cryptographic signatures prevent score forgery (optional enhancement)
- Hyperbee provides append-only audit trail

### Model Integrity
- Hypercore uses content-addressed storage (hash-based verification)
- Model key = hash of contents (automatic verification on download)
- Support for trusted seeder whitelists

### Network Attacks
- Implement per-client rate limiting
- Use score-based throttling (low-score clients get fewer requests)
- Track node behavior and ban malicious actors
- Optional: Proof-of-work for request submission

## Common Gotchas

### GPU Not Detected
If GPU layers = 0 despite having a GPU, manually set: `export GPU_LAYERS=33`

### Workers Not Discovering Each Other
- Check that all workers use the same network topic names
- DHT discovery can take 5-10 seconds
- Verify no firewall blocking UDP traffic
- Use `DEBUG=hyperswarm:* node examples/run-worker.js` for debugging

### Out of Memory
- Use smaller models (1B instead of 7B)
- Reduce context size in config (2048 → 512)
- Limit max queue size to reduce concurrent contexts
- Ensure old contexts are properly disposed

### Score Synchronization Issues
- Verify workers are connected to Score Network
- Check Hyperbee database isn't corrupted
- Ensure system clocks are reasonably synchronized
- Review score update broadcast logic

## Running Examples

Once implementation is complete:

```bash
# Terminal 1: Start first worker
node examples/run-worker.js

# Terminal 2: Start second worker (optional)
node examples/run-worker.js

# Terminal 3: Run client
node examples/basic-client.js

# Terminal 4: Test streaming
node examples/streaming-client.js
```

For Docker deployment, see [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md#docker-support).
