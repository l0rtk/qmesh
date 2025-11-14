# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

QMesh v2 is a **distributed peer-to-peer LLM inference network** that enables consumer devices to share computational resources for running large language models.

**Current Status:** Building PoC/MVP - focused on core P2P inference functionality without payments or complex prioritization.

## PoC Scope (Current Focus)

### What We're Building Now:
- ✅ P2P worker discovery via Hyperswarm
- ✅ LLM inference with node-llama-cpp
- ✅ Health-based worker selection (CPU/memory/queue metrics)
- ✅ Request/response messaging
- ✅ Basic load management (workers reject when overloaded)

### Explicitly NOT in PoC:
- ❌ Priority queues or credit system
- ❌ Payments or blockchain integration
- ❌ Score calculations or achievements
- ❌ Model distribution (use local models only)
- ❌ Complex worker selection algorithms
- ❌ Persistent score database (Hyperbee)

The PoC proves the core concept: **distributed LLM inference via P2P networking works and is practical.**

## Core Architecture (PoC)

### Single P2P Network

**Inference Network** (`qmesh-inference `):
- Worker discovery and availability broadcasting
- Client requests and worker responses
- Health status updates
- Participants: Clients + Workers

### Request Flow

```
Client → Discover Workers → Select Healthiest → Send Request → Receive Response
```

### Worker Selection Algorithm (Simplified)

Select the worker with the **best health score**:

```javascript
healthScore = (100 - cpuUsage) * 0.4
            + (100 - memoryUsage) * 0.4
            + queueAvailability * 0.2
```

- Pick the worker with **highest health score**
- If worker is overloaded (health < 20), it rejects requests
- No artificial rate limiting - workers self-regulate based on load

### Load Management

Workers calculate health in real-time:
- **CPU usage** (0-100%)
- **Memory usage** (0-100%)
- **Queue fullness** (current/capacity)

Health states:
- 🟢 **Healthy** (score > 60): Accept requests
- 🟡 **Busy** (score 20-60): Accept but slower
- 🔴 **Overloaded** (score < 20): Reject new requests

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Inference** | node-llama-cpp | Local LLM execution (1.8x faster than Ollama) |
| **P2P Network** | Hyperswarm | Peer discovery and messaging |
| **Model Format** | GGUF | Quantized models (Q4_0, Q4_K_M, etc.) |
| **GPU Acceleration** | Metal/CUDA/Vulkan | Auto-detected hardware acceleration |

## Development Commands

**Note:** Commands are planned but not fully implemented yet.

```bash
# Development
npm run dev                  # Start worker in development mode
npm start                    # Start worker in production mode

# Testing
npm test                     # Run all tests
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests only

# Code Quality
npm run lint                # Lint code (ESLint)
npm run format              # Format code (Prettier)

# Model Management
npm run download-models     # Download GGUF models from Hugging Face
npm run benchmark           # Run performance benchmarks
```

## Project Structure (PoC)

```
src/
├── worker/                 # Worker node implementation
│   ├── worker-node.js     # Main orchestrator - coordinates all subsystems
│   ├── model-loader.js    # GGUF model loading with GPU auto-detection
│   └── inference-engine.js # LLM inference with streaming support
├── client/                 # Client SDK
│   ├── qmesh-client.js    # Main client interface
│   └── worker-selector.js  # Health-based worker selection
├── lib/                    # Shared libraries
│   ├── network-manager.js  # Hyperswarm P2P networking
│   └── system-monitor.js   # CPU/memory/load monitoring
└── config/
    └── default.js         # Configuration (network topics, inference params)
```

**Removed from PoC** (available in [docs/](docs/) for future reference):
- `lib/priority-queue.js` - Multi-tier priority system
- `lib/score-manager.js` - Credit calculation
- `lib/global-score-manager.js` - Network score sync
- `lib/score-db.js` - Hyperbee persistence
- `lib/model-distribution.js` - P2P model sharing

## Key Implementation Patterns

### Message Protocol

All P2P messages use **length-prefixed JSON**:
```
[4-byte length (big-endian)] + [JSON message bytes]
```

**Message types:**
- `status` - Worker broadcasts availability and health
- `status_response` - Worker replies with current state
- `prompt` - Client sends inference request
- `inference_result` - Worker returns generated text
- `inference_error` - Worker signals failure

### GPU Detection Strategy

Models are loaded with automatic GPU detection:
- **macOS (ARM64):** Assume Metal, use 33 layers
- **Linux/Windows:** Check for `nvidia-smi`, use CUDA if available
- **Fallback:** CPU-only mode (0 GPU layers)

Override with environment variable: `GPU_LAYERS=-1` (auto) or `GPU_LAYERS=0` (CPU only)

### Context Management

The InferenceEngine creates contexts for LLM sessions:
- Each context maintains conversation state
- Contexts have busy/available status
- Reused across requests, never shared simultaneously
- Properly disposed to prevent memory leaks

### Health Monitoring

Workers continuously monitor:
- **CPU usage** via Node.js `os.cpus()`
- **Memory usage** via `os.totalmem()` / `os.freemem()`
- **Queue length** via internal counter

Health score is recalculated every 5-10 seconds and broadcast to network.

## Important Development Notes

### Model Files
- Models are **not committed to git** (stored in `models/` directory)
- Use quantized GGUF models (Q4_0 or Q4_K_M recommended)
- Start with **1B models** for testing (TinyLlama, Llama 3.2 1B)
- Download from Hugging Face: `https://huggingface.co/models?library=gguf`

Example download:
```bash
mkdir models
cd models
wget https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf
```

### Worker IDs
- Each worker generates a persistent ID on first run (stored in `worker-id.txt`)
- IDs are 64-character hex strings (32 random bytes)
- Never commit `worker-id.txt` to version control

### Error Handling
- Always use try/catch for async inference operations
- Return structured error responses with `type: 'inference_error'`
- Log errors but avoid exposing internal details to clients
- Workers gracefully degrade under load (reject vs crash)

### Testing Strategy
- **Unit tests:** Worker selection logic, health calculations, message parsing
- **Integration tests:** End-to-end inference, multi-worker coordination
- **Performance tests:** Latency benchmarks, throughput under load
- **Stress tests:** High concurrent requests, worker failures

## Implementation Timeline (PoC)

Reference [docs/IMPLEMENTATION_GUIDE.md](docs/IMPLEMENTATION_GUIDE.md) for detailed steps.

**PoC Timeline: 2-3 weeks**

1. **Phase 1** (3-5 days): Core inference engine with node-llama-cpp
   - Model loading with GPU auto-detection
   - Basic inference (streaming and non-streaming)
   - Context management

2. **Phase 2** (5-7 days): P2P networking with Hyperswarm
   - Network manager (join/leave topics, send/receive messages)
   - Worker node (broadcast availability, handle requests)
   - Client SDK (discover workers, send prompts)

3. **Phase 3** (2-3 days): Health-based worker selection
   - System monitoring (CPU/memory/queue)
   - Health score calculation
   - Worker selection algorithm

4. **Phase 4** (2-3 days): Testing and polish
   - Multi-worker scenarios
   - Error handling edge cases
   - Basic benchmarking

**Total:** 12-18 days for working PoC

## Performance Expectations (PoC)

**M1 MacBook Pro (8GB RAM):**
- Model load: 3-5 seconds
- Inference (1B): 50-80 tokens/sec (Metal GPU)
- Memory: ~1.5GB
- Throughput: ~100 req/hour/worker

**Desktop (16GB RAM, NVIDIA RTX 3060):**
- Model load: 2-3 seconds
- Inference (7B): 100-150 tokens/sec (CUDA GPU)
- Memory: ~5-8GB
- Throughput: ~200 req/hour/worker

**Network Scalability (PoC):**
- 3-5 workers: Demonstrates P2P coordination
- 10 workers: Shows load balancing
- 50+ workers: Validates DHT discovery at scale

## Documentation

Core implementation details are in [docs/](docs/):
- **[NEW_ARCHITECTURE.md](docs/NEW_ARCHITECTURE.md)**: Complete system design (includes future features)
- **[IMPLEMENTATION_GUIDE.md](docs/IMPLEMENTATION_GUIDE.md)**: Step-by-step build guide
- **[API_SPECIFICATION.md](docs/API_SPECIFICATION.md)**: API reference
- **[PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md)**: Codebase organization

**Note:** Documentation includes future features (scores, payments, model distribution) not in current PoC.

## Common Gotchas

### GPU Not Detected
If GPU layers = 0 despite having a GPU, manually set:
```bash
export GPU_LAYERS=33
```

### Workers Not Discovering Each Other
- Check that all workers use the same network topic: `qmesh-inference `
- DHT discovery can take 5-10 seconds
- Verify no firewall blocking UDP traffic
- Debug with: `DEBUG=hyperswarm:* node examples/run-worker.js`

### Out of Memory
- Use smaller models (1B instead of 7B)
- Reduce context size in config (2048 → 512)
- Ensure old contexts are properly disposed

### Worker Overload
- Workers should reject requests when health score < 20
- Check that health monitoring is running
- Verify queue capacity limits are enforced

## Running the PoC

Once implementation is complete:

```bash
# Terminal 1: Start first worker
node examples/run-worker.js

# Terminal 2: Start second worker (optional)
node examples/run-worker.js

# Terminal 3: Run client
node examples/basic-client.js
```

Expected output:
```
🌐 Discovered 2 workers
✅ Selected worker abc123 (health: 87)
📤 Sending prompt...
📥 Response: [AI generated text]
⏱️  Total time: 1.2s
```

## Future Enhancements (Post-PoC)

### Phase 2: Priority & Credits
- Multi-tier priority queue (6 tiers: Master → Bronze)
- Credit system: earn by contributing, spend to request
- FIFO ordering within priority tiers
- Achievement system with score bonuses
- Persistent score database (Hyperbee)
- Network-wide score synchronization

### Phase 3: Blockchain Payments
- **Solana integration** for real economic incentives
- Workers earn SOL/USDC for processing requests
- Clients pay per request (micro-transactions)
- Dynamic pricing based on model size, load, urgency
- **Proof-of-Inference** mechanisms:
  - Optimistic verification with slashing
  - Redundant computation (sampling)
  - Verifiable checkpoints (intermediate activations)
  - Trusted Execution Environments (TEE/SGX)

### Phase 4: Advanced Features
- P2P model distribution via Hypercore/Hyperdrive
- Multi-model support (1B, 3B, 7B, 13B)
- Automatic model selection based on request complexity
- Regional worker clustering for low latency
- WebSocket support for web clients
- Streaming responses
- Rate limiting and anti-spam

### Phase 5: Production Hardening
- Reputation system (track worker reliability)
- Fraud detection and prevention
- Comprehensive monitoring (Prometheus/Grafana)
- Load balancing and failover
- Encrypted communication
- Privacy-preserving inference (zero-knowledge proofs)

## Why Blockchain for Payments?

The current PoC uses **trust-based cooperation**. For production scale, blockchain payments solve:

1. **Real incentives**: Workers earn actual money (not just credits)
2. **Market dynamics**: Supply/demand pricing finds equilibrium
3. **Separation of roles**: Pure workers (earn) vs pure clients (pay)
4. **Scalability**: Economic incentives attract more participants

**Solana is ideal** because:
- Fast (400ms blocks)
- Cheap (fractions of a penny per transaction)
- High throughput (65,000 TPS capacity)
- Existing ecosystem (wallets, DeFi, tooling)

See [docs/NEW_ARCHITECTURE.md](docs/NEW_ARCHITECTURE.md) for full economic model design.

## Contributing

When implementing new features:
- Keep the PoC simple and focused
- Add complexity incrementally
- Test each component thoroughly
- Document design decisions
- Follow existing code patterns (ES modules, async/await, error handling)

## Architecture Decisions

### Why node-llama-cpp?
- **1.8x faster** than Ollama (161 vs 89 tokens/sec)
- Direct llama.cpp bindings (minimal overhead)
- Cross-platform GPU support (Metal, CUDA, Vulkan)
- Same GGUF format as production tools
- Active development and community

### Why Hyperswarm?
- DHT-based discovery (no central servers)
- NAT traversal built-in
- Encrypted connections by default
- Battle-tested (powers Holepunch ecosystem)
- Simple API for P2P messaging

### Why Health-Based Selection?
- Simple to implement and understand
- Naturally balances load across workers
- No need for complex coordination
- Workers self-regulate (reject when overloaded)
- Easy to extend (add latency, reputation, etc.)

## License

[Specify license - e.g., MIT, Apache 2.0, etc.]
