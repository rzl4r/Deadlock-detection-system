/**
 * ═══════════════════════════════════════════════════
 *  DeadlockScan — script.js
 *  Author: DeadlockScan v1.0
 *
 *  Modules:
 *   1. State Management     — app state, process/resource registry
 *   2. UI Rendering         — table rows, resource chips
 *   3. Deadlock Detection   — Wait-For Graph + DFS Cycle Detection
 *   4. Graph Visualization  — Vis.js network
 *   5. Result Display       — output panel rendering
 *   6. Toast Notifications  — user feedback
 *   7. Demo / Reset         — preset scenarios
 * ═══════════════════════════════════════════════════
 */

/* ══════════════════════════════════════════════
   1. STATE MANAGEMENT
   ══════════════════════════════════════════════ */

/**
 * App state holds:
 *  - processes: array of { id, allocated: [], requested: [] }
 *  - resources:  Set of resource names (strings)
 *  - network:    Vis.js Network instance
 */
const state = {
  processes: [],          // array of process objects
  resources: new Set(),   // all known resource names
  network: null,          // Vis.js graph instance
  processCounter: 1,      // auto-increment for process IDs
};

/* ══════════════════════════════════════════════
   2. UI RENDERING — TABLE ROWS & RESOURCE CHIPS
   ══════════════════════════════════════════════ */

/**
 * Adds a new empty process row to the allocation table.
 * Each row has: process label, allocated input, requested input, delete button.
 */
function addProcessRow(allocVal = '', reqVal = '') {
  const pid = `P${state.processCounter++}`;

  // Create process object in state
  const proc = { id: pid, allocated: [], requested: [] };
  state.processes.push(proc);

  const tbody = document.getElementById('allocBody');
  const tr = document.createElement('tr');
  tr.dataset.pid = pid;

  tr.innerHTML = `
    <td><span class="proc-label">${pid}</span></td>
    <td>
      <input
        type="text"
        placeholder="e.g. R1, R2"
        value="${allocVal}"
        title="Comma-separated resources this process holds"
        onchange="updateProcess('${pid}', 'allocated', this.value)"
        oninput="syncResourcesFromTable()"
      />
    </td>
    <td>
      <input
        type="text"
        placeholder="e.g. R3"
        value="${reqVal}"
        title="Comma-separated resources this process is waiting for"
        onchange="updateProcess('${pid}', 'requested', this.value)"
        oninput="syncResourcesFromTable()"
      />
    </td>
    <td>
      <button class="btn-del" onclick="removeProcessRow('${pid}')" title="Remove process">✕</button>
    </td>
  `;

  tbody.appendChild(tr);
  animateIn(tr);

  // Initialize with provided values
  if (allocVal) updateProcess(pid, 'allocated', allocVal);
  if (reqVal)   updateProcess(pid, 'requested', reqVal);
}

/**
 * Updates a process's allocated or requested arrays
 * by parsing comma-separated resource names from the input.
 *
 * @param {string} pid       - Process ID (e.g. "P1")
 * @param {string} field     - "allocated" or "requested"
 * @param {string} rawValue  - Raw text from the input field
 */
function updateProcess(pid, field, rawValue) {
  const proc = state.processes.find(p => p.id === pid);
  if (!proc) return;

  // Split by comma, trim whitespace, filter empty strings, uppercase
  const items = rawValue
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);

  proc[field] = items;

  // Register any new resource names automatically
  items.forEach(r => state.resources.add(r));
  renderResourceChips();
}

/**
 * Removes a process row from the table and from state.
 *
 * @param {string} pid - Process ID to remove
 */
function removeProcessRow(pid) {
  // Remove from state
  state.processes = state.processes.filter(p => p.id !== pid);

  // Remove from DOM
  const row = document.querySelector(`tr[data-pid="${pid}"]`);
  if (row) {
    row.style.opacity = '0';
    row.style.transform = 'translateX(-10px)';
    row.style.transition = 'all 0.2s ease';
    setTimeout(() => row.remove(), 200);
  }

  syncResourcesFromTable();
}

/**
 * Re-scans all rows and refreshes the global resource set.
 * Called whenever input changes.
 */
function syncResourcesFromTable() {
  const newResources = new Set();

  state.processes.forEach(proc => {
    [...proc.allocated, ...proc.requested].forEach(r => {
      if (r) newResources.add(r.toUpperCase());
    });
  });

  // Read current input values from DOM (for live sync)
  document.querySelectorAll('#allocBody tr').forEach(row => {
    const inputs = row.querySelectorAll('input');
    if (inputs.length >= 2) {
      [inputs[0].value, inputs[1].value].forEach(val => {
        val.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
           .forEach(r => newResources.add(r));
      });
    }
  });

  // Preserve manually added resources that aren't in table
  state.resources.forEach(r => {
    if (!newResources.has(r)) {
      // If the resource isn't in ANY process, keep it only if manually added
      // (We keep it to avoid surprises — user can delete from chip)
    }
  });

  state.resources = newResources;
  renderResourceChips();
}

/**
 * Renders the resource chips in the resource registry panel.
 */
function renderResourceChips() {
  const container = document.getElementById('resourceList');
  container.innerHTML = '';

  if (state.resources.size === 0) {
    container.innerHTML = `<span style="color:var(--text-muted);font-size:11px;">No resources yet — type in the table above.</span>`;
    return;
  }

  [...state.resources].sort().forEach(r => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.dataset.resource = r;
    chip.innerHTML = `
      ${r}
      <button class="chip-del" onclick="removeResource('${r}')" title="Remove resource">×</button>
    `;
    container.appendChild(chip);
  });
}

/**
 * Removes a resource from the global registry.
 */
function removeResource(name) {
  state.resources.delete(name);
  renderResourceChips();
}

/**
 * Allows manually adding a resource via prompt.
 */
function addResourceGlobal() {
  const name = prompt('Enter resource name (e.g. R5):');
  if (!name || !name.trim()) return;
  state.resources.add(name.trim().toUpperCase());
  renderResourceChips();
}

/* ══════════════════════════════════════════════
   3. DEADLOCK DETECTION — WAIT-FOR GRAPH + DFS
   ══════════════════════════════════════════════ */

/**
 * Builds the Wait-For Graph (WFG) from the current process state.
 *
 * In a WFG:
 *  - Nodes  = Processes
 *  - Edge P_i → P_j = P_i is waiting for a resource held by P_j
 *
 * Algorithm:
 *  1. For each process P_i that requests resource R:
 *     a. Find all processes P_j that have allocated R
 *     b. Add edge P_i → P_j (P_i waits for P_j to release R)
 *
 * @returns {{ nodes: string[], edges: {from, to, resource}[] }}
 */
function buildWaitForGraph() {
  const nodes = state.processes.map(p => p.id);
  const edges = [];

  state.processes.forEach(waiter => {
    // For each resource this process is waiting for
    waiter.requested.forEach(resource => {
      // Find all processes that currently hold this resource
      state.processes.forEach(holder => {
        if (holder.id !== waiter.id && holder.allocated.includes(resource)) {
          edges.push({
            from:     waiter.id,
            to:       holder.id,
            resource: resource,
          });
        }
      });
    });
  });

  return { nodes, edges };
}

/**
 * Detects cycles in the Wait-For Graph using iterative DFS.
 *
 * A deadlock exists if and only if the WFG contains a cycle.
 *
 * DFS Coloring:
 *  - WHITE (0) = not yet visited
 *  - GRAY  (1) = currently in the recursion stack (being processed)
 *  - BLACK (2) = fully processed (no cycle through this node)
 *
 * @param {{ nodes: string[], edges: {from, to}[] }} graph
 * @returns {{ hasCycle: boolean, cycles: string[][] }}
 */
function detectCycles(graph) {
  // Build adjacency list: node → [neighbour nodes]
  const adj = {};
  graph.nodes.forEach(n => { adj[n] = []; });
  graph.edges.forEach(e => {
    if (!adj[e.from]) adj[e.from] = [];
    adj[e.from].push(e.to);
  });

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color  = {};
  const parent = {};
  graph.nodes.forEach(n => { color[n] = WHITE; parent[n] = null; });

  const cycles    = [];
  let   hasCycle  = false;

  /**
   * Recursive DFS visit.
   * Returns true if a back-edge (cycle) is found from this node.
   *
   * @param {string} u - current node
   * @returns {boolean}
   */
  function dfsVisit(u) {
    color[u] = GRAY; // Mark as "in stack"

    for (const v of (adj[u] || [])) {
      if (color[v] === GRAY) {
        // Back edge found — we have a cycle!
        hasCycle = true;

        // Trace back the cycle path
        const cycle = [v, u];
        let cur = u;
        while (parent[cur] && parent[cur] !== v) {
          cur = parent[cur];
          cycle.unshift(cur);
        }
        cycle.unshift(v); // close the loop
        cycles.push(cycle);
        return true;
      }
      if (color[v] === WHITE) {
        parent[v] = u;
        if (dfsVisit(v)) return true;
      }
    }

    color[u] = BLACK; // Done — no cycle through this node
    return false;
  }

  // Run DFS from every unvisited node
  // (handles disconnected graphs)
  graph.nodes.forEach(n => {
    if (color[n] === WHITE) {
      dfsVisit(n);
    }
  });

  return { hasCycle, cycles };
}

/**
 * Gathers all processes involved in any detected cycle.
 *
 * @param {string[][]} cycles - array of cycle paths
 * @returns {string[]} unique process IDs involved
 */
function getDeadlockedProcesses(cycles) {
  const involved = new Set();
  cycles.forEach(cycle => cycle.forEach(pid => involved.add(pid)));
  return [...involved];
}

/* ══════════════════════════════════════════════
   4. GRAPH VISUALIZATION (Vis.js)
   ══════════════════════════════════════════════ */

/**
 * Renders the Wait-For Graph using Vis.js Network.
 *
 * Visual encoding:
 *  - Normal processes → cyan nodes
 *  - Deadlocked processes → red nodes with glow
 *  - Normal edges → gray arrows
 *  - Cycle edges → red arrows (thick)
 *
 * @param {{ nodes: string[], edges: object[] }} graph
 * @param {string[]} deadlockedProcs - processes in a cycle
 * @param {string[][]} cycles        - detected cycle paths
 */
function renderGraph(graph, deadlockedProcs, cycles) {
  const deadSet = new Set(deadlockedProcs);

  // ── Build Vis Nodes ──
  const visNodes = graph.nodes.map(pid => ({
    id:    pid,
    label: pid,
    title: `Process ${pid}`,
    color: {
      background: deadSet.has(pid) ? '#3d1515' : '#0f1a2e',
      border:     deadSet.has(pid) ? '#f87171' : '#00d4ff',
      highlight: {
        background: deadSet.has(pid) ? '#5c1c1c' : '#0f2a4a',
        border:     deadSet.has(pid) ? '#f87171' : '#00d4ff',
      },
      hover: {
        background: deadSet.has(pid) ? '#4a1818' : '#0f2040',
        border:     deadSet.has(pid) ? '#f87171' : '#00d4ff',
      },
    },
    font: {
      color:      deadSet.has(pid) ? '#f87171' : '#00d4ff',
      size:       14,
      face:       'JetBrains Mono, monospace',
      bold:       { color: deadSet.has(pid) ? '#f87171' : '#00d4ff' },
    },
    shape:       'box',
    borderWidth: deadSet.has(pid) ? 2 : 1.5,
    shadow:      deadSet.has(pid)
      ? { enabled: true, color: 'rgba(248,113,113,0.4)', size: 12, x: 0, y: 0 }
      : { enabled: true, color: 'rgba(0,212,255,0.15)',  size: 8,  x: 0, y: 0 },
    margin: 10,
  }));

  // Determine which edges are part of a cycle
  const cycleEdgeSet = new Set();
  cycles.forEach(cycle => {
    for (let i = 0; i < cycle.length - 1; i++) {
      cycleEdgeSet.add(`${cycle[i]}->${cycle[i + 1]}`);
    }
  });

  // ── Build Vis Edges ──
  const visEdges = graph.edges.map((e, idx) => {
    const key     = `${e.from}->${e.to}`;
    const isCycle = cycleEdgeSet.has(key);
    return {
      id:    idx,
      from:  e.from,
      to:    e.to,
      label: e.resource,
      title: `${e.from} waits for ${e.resource} held by ${e.to}`,
      color: {
        color:   isCycle ? '#f87171' : '#3a4560',
        opacity: isCycle ? 1 : 0.7,
      },
      width:     isCycle ? 2.5 : 1.5,
      dashes:    !isCycle,
      arrows:    { to: { enabled: true, scaleFactor: 0.8 } },
      font: {
        color: isCycle ? '#f87171' : '#6b7a9a',
        size:  10,
        face:  'JetBrains Mono, monospace',
        align: 'middle',
        background: 'rgba(15,17,23,0.8)',
      },
      smooth: { type: 'curvedCW', roundness: 0.2 },
    };
  });

  // ── Vis.js Options ──
  const options = {
    physics: {
      enabled: true,
      solver:  'forceAtlas2Based',
      forceAtlas2Based: {
        gravitationalConstant: -80,
        centralGravity:        0.01,
        springLength:          140,
        springConstant:        0.05,
        damping:               0.4,
      },
      stabilization: { iterations: 200, updateInterval: 25 },
    },
    interaction: {
      hover:        true,
      tooltipDelay: 100,
      dragNodes:    true,
      zoomView:     true,
    },
    layout: {
      improvedLayout: true,
    },
    nodes: {
      borderWidthSelected: 3,
    },
    edges: {
      selectionWidth: 3,
    },
  };

  // ── Mount into DOM ──
  const container = document.getElementById('graphContainer');
  const placeholder = document.getElementById('graphPlaceholder');

  container.style.display = 'block';
  placeholder.style.display = 'none';

  // Destroy previous instance if it exists
  if (state.network) {
    state.network.destroy();
    state.network = null;
  }

  const data = {
    nodes: new vis.DataSet(visNodes),
    edges: new vis.DataSet(visEdges),
  };

  state.network = new vis.Network(container, data, options);

  // After stabilization, disable physics for cleaner UX
  state.network.once('stabilizationIterationsDone', () => {
    state.network.setOptions({ physics: { enabled: false } });
  });
}

/* ══════════════════════════════════════════════
   5. RESULT DISPLAY
   ══════════════════════════════════════════════ */

/**
 * Renders the result panel based on detection output.
 *
 * @param {boolean}  hasCycle          - whether a deadlock exists
 * @param {string[]} deadlockedProcs   - processes involved in deadlock
 * @param {string[][]} cycles          - detected cycle paths
 * @param {string[]} allProcs          - all process IDs
 */
function renderResult(hasCycle, deadlockedProcs, cycles, allProcs) {
  const resultBody = document.getElementById('resultBody');
  const safeProcs  = allProcs.filter(p => !deadlockedProcs.includes(p));

  let html = '';

  if (!hasCycle) {
    // ── Safe State ──
    html += `
      <div class="result-box safe">
        <div class="result-icon">✅</div>
        <div>
          <div class="result-title">No Deadlock Detected</div>
          <div class="result-desc">All processes can complete. The system is in a safe state.</div>
        </div>
      </div>
    `;
    html += `
      <div class="details-block">
        <div class="details-label">All Processes (Safe)</div>
        <div class="process-tags">
          ${allProcs.map(p => `<span class="proc-tag safe-tag">${p}</span>`).join('')}
        </div>
      </div>
    `;
  } else {
    // ── Deadlock Detected ──
    html += `
      <div class="result-box deadlock">
        <div class="result-icon">🔴</div>
        <div>
          <div class="result-title">Deadlock Detected!</div>
          <div class="result-desc">A circular wait exists. The highlighted processes are stuck indefinitely.</div>
        </div>
      </div>
    `;

    // Deadlocked processes
    html += `
      <div class="details-block">
        <div class="details-label">⚠ Deadlocked Processes</div>
        <div class="process-tags">
          ${deadlockedProcs.map(p => `<span class="proc-tag dead-tag">${p}</span>`).join('')}
        </div>
      </div>
    `;

    // Safe processes
    if (safeProcs.length > 0) {
      html += `
        <div class="details-block">
          <div class="details-label">✓ Safe Processes</div>
          <div class="process-tags">
            ${safeProcs.map(p => `<span class="proc-tag safe-tag">${p}</span>`).join('')}
          </div>
        </div>
      `;
    }

    // Cycle paths
    cycles.forEach((cycle, i) => {
      const pathStr = [...cycle, cycle[0]].join(' → ');
      html += `
        <div class="details-block">
          <div class="details-label">Cycle ${i + 1} Path</div>
          <div class="cycle-path">${pathStr}</div>
        </div>
      `;
    });

    // Recovery suggestion
    const victimProc = deadlockedProcs[0];
    html += `
      <div class="recovery-block">
        <div class="recovery-title">💡 Recovery Suggestion</div>
        <div class="recovery-text">
          Terminate process <span class="recovery-proc">${victimProc}</span> to break the deadlock cycle.
          This forces ${victimProc} to release its held resources, allowing other processes to proceed.
          <br/><br/>
          Alternative: Use resource preemption — forcefully reclaim resources from
          <span class="recovery-proc">${deadlockedProcs.join(', ')}</span> and roll back their state.
        </div>
      </div>
    `;
  }

  resultBody.innerHTML = html;
}

/* ══════════════════════════════════════════════
   6. MAIN ORCHESTRATOR — runDetection()
   ══════════════════════════════════════════════ */

/**
 * Main entry point called when user clicks "Run Detection".
 *
 * Steps:
 *  1. Validate inputs
 *  2. Sync all process data from DOM
 *  3. Build Wait-For Graph
 *  4. Run DFS cycle detection
 *  5. Render graph visualization
 *  6. Display results
 */
function runDetection() {
  // ── Step 1: Validate ──
  if (state.processes.length === 0) {
    showToast('Add at least one process before running.', 'error');
    return;
  }

  // Sync latest values from all input fields (safety measure)
  document.querySelectorAll('#allocBody tr').forEach(row => {
    const pid    = row.dataset.pid;
    const inputs = row.querySelectorAll('input');
    if (!pid || inputs.length < 2) return;
    updateProcess(pid, 'allocated', inputs[0].value);
    updateProcess(pid, 'requested', inputs[1].value);
  });

  const allProcs = state.processes.map(p => p.id);

  // Check if any process actually requests anything
  const hasRequests = state.processes.some(p => p.requested.length > 0);
  if (!hasRequests) {
    showToast('No requests found. Add resources to the "Requested" column.', 'error');
    return;
  }

  // ── Step 2: Build Wait-For Graph ──
  const graph = buildWaitForGraph();
  console.log('[DeadlockScan] Wait-For Graph:', graph);

  // ── Step 3: Detect Cycles via DFS ──
  const { hasCycle, cycles } = detectCycles(graph);
  console.log('[DeadlockScan] Detection result:', { hasCycle, cycles });

  // ── Step 4: Identify deadlocked processes ──
  const deadlockedProcs = hasCycle ? getDeadlockedProcesses(cycles) : [];

  // ── Step 5: Render Graph ──
  renderGraph(graph, deadlockedProcs, cycles);

  // ── Step 6: Display Results ──
  renderResult(hasCycle, deadlockedProcs, cycles, allProcs);

  // Feedback toast
  if (hasCycle) {
    showToast(`Deadlock detected in ${deadlockedProcs.length} process(es).`, 'error');
  } else {
    showToast('System is safe — no deadlock found.', 'success');
  }
}

/* ══════════════════════════════════════════════
   7. TOAST NOTIFICATIONS
   ══════════════════════════════════════════════ */

/**
 * Shows a dismissing toast notification.
 *
 * @param {string} message - message to display
 * @param {string} type    - 'error' | 'success' | ''
 */
function showToast(message, type = '') {
  // Create container if it doesn't exist
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  // Auto-dismiss after 3 seconds
  setTimeout(() => {
    toast.style.opacity    = '0';
    toast.style.transform  = 'translateX(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/* ══════════════════════════════════════════════
   8. DEMO & RESET
   ══════════════════════════════════════════════ */

/**
 * Loads a demo scenario that demonstrates a classic 3-process deadlock:
 *
 *  P1 holds R1, requests R2
 *  P2 holds R2, requests R3
 *  P3 holds R3, requests R1
 *
 * This creates a cycle: P1 → P2 → P3 → P1
 */
function loadDemo() {
  resetTable(false);

  // Predefined demo data
  const demoData = [
    { alloc: 'R1',     req: 'R2' },  // P1: holds R1, wants R2
    { alloc: 'R2',     req: 'R3' },  // P2: holds R2, wants R3
    { alloc: 'R3',     req: 'R1' },  // P3: holds R3, wants R1 → DEADLOCK
    { alloc: 'R4, R5', req: 'R6' },  // P4: holds R4,R5, wants R6 → SAFE
  ];

  demoData.forEach(d => addProcessRow(d.alloc, d.req));

  showToast('Demo loaded! Click Run Detection to analyze.', 'success');
}

/**
 * Resets the entire tool — clears state and UI.
 *
 * @param {boolean} [showMsg=true] - whether to show a toast on reset
 */
function resetTable(showMsg = true) {
  // Clear state
  state.processes       = [];
  state.resources       = new Set();
  state.processCounter  = 1;

  if (state.network) {
    state.network.destroy();
    state.network = null;
  }

  // Clear DOM
  document.getElementById('allocBody').innerHTML       = '';
  document.getElementById('resourceList').innerHTML    = '';
  document.getElementById('resultBody').innerHTML      = `
    <div class="result-idle">
      <span class="idle-icon">◌</span>
      <p>Awaiting analysis…</p>
    </div>
  `;

  // Reset graph area
  const container   = document.getElementById('graphContainer');
  const placeholder = document.getElementById('graphPlaceholder');
  container.style.display   = 'none';
  placeholder.style.display = 'flex';

  renderResourceChips();

  if (showMsg) showToast('Reset complete.', '');
}

/* ══════════════════════════════════════════════
   9. UTILITY HELPERS
   ══════════════════════════════════════════════ */

/**
 * Animates a newly created DOM element in with a fade+slide effect.
 *
 * @param {HTMLElement} el - element to animate
 */
function animateIn(el) {
  el.style.opacity   = '0';
  el.style.transform = 'translateY(-6px)';
  el.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.opacity   = '1';
      el.style.transform = 'translateY(0)';
    });
  });
}

/* ══════════════════════════════════════════════
   10. INIT
   ══════════════════════════════════════════════ */

/**
 * Initializes the app on page load.
 * Adds two default empty process rows to get the user started.
 */
document.addEventListener('DOMContentLoaded', () => {
  // Add initial two rows
  addProcessRow();
  addProcessRow();

  console.log('[DeadlockScan] Initialized. Add processes and click Run Detection.');
});