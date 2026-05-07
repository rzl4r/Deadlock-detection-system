# DeadlockScan — Deadlock Detection Tool

A fully working, visually polished OS Deadlock Detection Tool built with
HTML, CSS, JavaScript, and Vis.js. No backend or build tools required.

---

## 📁 Project Structure

```
deadlock-tool/
├── index.html    ← Main page (structure & layout)
├── style.css     ← All styling (dark terminal theme)
├── script.js     ← All logic (detection, graph, UI)
└── README.md     ← This file
```

---

## 🚀 How to Run Locally

### Option A — Just open in browser (simplest)

1. Download or clone the project folder.
2. Double-click `index.html` to open it in your browser.
3. Done! No server needed.

> Works in: Chrome, Firefox, Edge, Safari

---

### Option B — Serve with Python (recommended for demos)

```bash
# Navigate to the project folder
cd deadlock-tool

# Python 3
python -m http.server 3000

# Then open: http://localhost:3000
```

---

### Option C — Serve with Node.js

```bash
# Install serve globally (one-time)
npm install -g serve

# Run in project folder
cd deadlock-tool
serve .

# Then open the URL shown in terminal (usually http://localhost:3000)
```

---

## 🌐 Deploy to GitHub Pages

1. Push the project folder to a GitHub repository.
2. Go to **Settings → Pages**.
3. Set source to **main branch / root**.
4. Your site will be live at:  
   `https://<your-username>.github.io/<repo-name>/`

---

## 🎮 How to Use

1. **Add Processes** — Click "＋ Add Process" or use the ⚡ Demo button.
2. **Fill Allocated** — Enter resources this process currently holds (e.g. `R1, R2`).
3. **Fill Requested** — Enter resources this process is waiting for (e.g. `R3`).
4. **Run Detection** — Click the blue "▶ Run Deadlock Detection" button.
5. **Read Results** — The graph highlights cycles in red; the result panel shows details.

---

## ⚙️ Algorithm

**Wait-For Graph Construction:**
- For each process P_i requesting resource R:
  - Find all processes P_j that hold R
  - Add directed edge: P_i → P_j

**Cycle Detection (DFS Coloring):**
- WHITE = not visited
- GRAY  = in current DFS stack
- BLACK = fully processed

A cycle (deadlock) exists when we encounter a GRAY node during DFS traversal — meaning we've found a back edge (circular wait).

**Time Complexity:** O(V + E) where V = processes, E = wait-for edges.

---

## 🎨 Tech Stack

| Technology | Purpose |
|---|---|
| HTML5 | Structure |
| CSS3 (custom) | Dark terminal theme, animations |
| Vanilla JavaScript | All logic, state management |
| Vis.js (CDN) | Interactive graph visualization |
| Google Fonts | JetBrains Mono + Syne |

---

## 📸 Demo Scenario (built-in)

Click **⚡ Demo** to load:

```
P1: holds R1 → requests R2
P2: holds R2 → requests R3
P3: holds R3 → requests R1   ← DEADLOCK CYCLE
P4: holds R4,R5 → requests R6  ← SAFE
```

Cycle: P1 → P2 → P3 → P1
