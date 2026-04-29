# The Edge — A Journey in Eight Rooms

## Specification Document

### Overview

**The Edge** is an interactive A-Frame experience that delivers the content of a university lecture (MSc Creative Computing, Lecture 3: "Situating Research in a Field — Finding the Gap") through a sequence of eight surreal 3D environments. Students navigate room to room, discovering lecture concepts embedded in the world as interactive objects, and making decisions that test their understanding.

The aesthetic is surreal and Lynchian — uncanny interiors, impossible spaces, and a dreamlike progression toward a literal cliff edge representing the frontier of knowledge.

### Technical Setup

- **Framework:** A-Frame (use whatever version the host repo runs — currently the repo uses A-Frame 1.3 with a-game for locomotion and interaction)
- **Interaction model:** Use the repo's existing a-game interaction system for click events. Do NOT use A-Frame's built-in `cursor` component — it does not reliably fire click events in this setup
- **Navigation between rooms:** Each room is a separate HTML file. The exit from each room is an HTML anchor link (`<a href="roomN.html">`) displayed as an overlay element, not an in-scene 3D object. All files must be in the same directory
- **No build step, no external dependencies** beyond A-Frame and a-game
- **Desktop only** — WASD movement, mouse look, click to interact

### Interaction Pattern (applies to all rooms)

Every room follows the same pattern:

1. **The student enters the room** and sees a 3D environment with one or more interactive objects
2. **Interactive objects** are clearly marked (floating text label like "?", "KNOCK", "READ", or a number). They should glow or pulse subtly to signal interactivity
3. **Clicking an interactive object** triggers an HTML overlay at the bottom of the screen (the "message box") containing lecture content. The overlay has a speaker label, body text, and a dismiss button
4. **Once all objects in a room are clicked**, either:
   - A **decision/riddle** appears (an HTML overlay centred on screen with a question and 2–4 multiple choice buttons), OR
   - The **exit link** appears (top-right corner HTML overlay linking to the next room)
5. **Decisions** work as follows: clicking an answer disables all buttons, highlights the chosen answer as correct (green border) or wrong (red border), shows the correct answer if the student got it wrong, displays a feedback paragraph, then after 4 seconds auto-dismisses and shows the exit link
6. **Objects can only be clicked once.** After clicking, the label disappears and the object becomes non-interactive

### Room-by-Room Specification

---

#### Room 1 — The Red Room

**Theme:** Lynchian red curtain room. Introduction and briefing.

**Environment:**
- Small rectangular room with red velvet curtain walls (deep crimson boxes with fold detail)
- Black and white chevron-striped floor (alternating dark/light thin planes on the ground)
- Warm amber lighting from a floor lamp and a desk lamp
- A figure stands centre-back: a simple humanoid shape (cylinder body, sphere head, dark suit, skin-coloured face, dark eyes). Small table with a glowing orb beside them
- An empty chair faces the figure (the student's implied seat)

**Interaction:**
- One clickable object: the figure (use an invisible click target box around it)
- Floating "click" label above the figure, gently bobbing

**Content delivered on click:**

> **Speaker:** The Figure
>
> **Text:** "You cannot find the edge from inside your own head. You find it by reading what exists, understanding what it does, and identifying what it doesn't do. That gap — between what exists and what doesn't yet — is where your research lives. Go. Find the edge."

**Decision:** None

**Exit:** After clicking the figure and dismissing the message, the exit link appears: "Enter the corridor →" linking to `room2.html`

**Intro overlay:** This room (and only this room) has a full-screen black intro overlay shown on load with:
- Title: "THE EDGE"
- Subtitle: "A Journey in Eight Rooms"
- Flavour text: "You are looking for something that doesn't exist yet. You won't find it by staying where you are. You have to go to the edge."
- Control instructions: "WASD move · click + drag look · click objects to interact"
- "[ click to enter ]" — clicking anywhere dismisses the overlay

---

#### Room 2 — The Corridor

**Theme:** An impossibly long corridor with doors. Voices behind the doors.

**Lecture content:** What is a field? (Slides 3–4)

**Environment:**
- Long narrow corridor (4 units wide, 40 units long)
- Dark blue-grey walls, dark floor, periodic pools of cool blue-purple light from ceiling fixtures
- Four doors set into alternating walls at intervals along the corridor (left, right, left, right)
- Each door is a recessed rectangle in the wall with a small glowing doorknob (a small metallic cube or sphere)
- At the far end of the corridor, faint text on the wall reads: "Every conversation has a history. Learn it."
- Floating instruction text near the start: "Walk forward. Knock on the doors."

**Interaction:**
- Four clickable objects: the doorknobs (one per door)
- Each has a floating "KNOCK" label

**Content delivered on click:**

Door 1:
> **Speaker:** Voice behind the door
>
> **Text:** "A field is not a topic. It is not a discipline. It is the community of people working on related problems, and the body of work they have produced. It is a living, ongoing conversation."

Door 2:
> **Speaker:** Voice behind the door
>
> **Text:** "In creative computing, your field is almost never a single discipline. It might include a technical literature, an artistic lineage, a critical discourse, and a design community. You don't need to master all of these — but you need to know which ones matter for your project."

Door 3:
> **Speaker:** Voice behind the door
>
> **Text:** "You wouldn't walk into a room full of people discussing something, ignore everything they've said, and start talking about your own thing. That's what a project without context looks like. A literature review is proof that you've been listening."

Door 4 (visually distinct — different colour glow, suggesting this one is different):
> Triggers the decision instead of a message.

**Decision (triggered after Door 4 is clicked):**

> **Question:** A student says their project is interdisciplinary, so it doesn't fit any field. What's the problem with this claim?
>
> **Option A:** They're right — truly original work transcends fields. *(wrong)*
>
> **Option B:** Interdisciplinary work sits at the intersection of multiple fields. You still need to know those fields. Being between them isn't the same as being outside them. *(correct)*
>
> **Option C:** They should pick one field and commit to it. *(wrong)*
>
> **Correct feedback:** "Correct. Interdisciplinarity is harder, not easier. You have to read in multiple directions. The intersection is where the work lives — not the void."
>
> **Wrong feedback:** "Not quite. Interdisciplinary work sits between fields, not outside them. You still need to know the conversations happening in each. It's harder, not easier."

**Exit:** Appears after all four doors are knocked and the decision is resolved. "Through the final door →" linking to `room3.html`

---

#### Room 3 — The Filing Room

**Theme:** A room full of filing cabinets with a single illuminated file on a central table.

**Lecture content:** The literature review is an argument, not a reading list (Slide 5); the five extraction questions (Slide 9)

**Environment:**
- Square room, rows of filing cabinets along left and right walls
- Scattered papers on the floor (angled planes, low opacity)
- Central table with one open file/folder glowing under a warm light
- A stack of papers on the floor in one corner (separate clickable object)
- Single fluorescent tube on the ceiling, plus a flickering light in one corner for atmosphere
- Overall colour: warm amber/sepia

**Interaction:**
- Two clickable objects: the open file on the table, and the paper stack in the corner
- Labels: "READ" above the file (bobbing), "?" above the papers

**Content delivered on click:**

The file:
> **Speaker:** The File
>
> **Text:** "A literature review is not a summary of everything you've read. It is an argument about the state of a field. It says: here is what exists; here is what it does well; here is what it doesn't do, or hasn't yet tried; and here is the gap — which my project will address."

The papers:
> **Speaker:** The Papers
>
> **Text:** "For each paper, extract five things: What's the research question? What's the method? What's the contribution? What are the limitations? How does it relate to your project? Do this for every paper. By the end, you've almost written your review without realising."

**Decision (triggered after both objects are clicked):**

> **Question:** A room full of filing cabinets. Thousands of papers. You've read dozens. What makes the difference between a bibliography and scholarship?
>
> **Option A:** A bibliography lists what you read. Scholarship makes an argument about what those things, taken together, leave missing. *(correct)*
>
> **Option B:** Scholarship is just a bibliography with commentary added to each entry. *(wrong)*
>
> **Option C:** The difference is how many papers you include — more papers means more scholarly. *(wrong)*
>
> **Correct feedback:** "Yes. The review is selective and purposeful. You include what's relevant to your argument and omit what isn't, even if you read it. It's an argument, not a list."
>
> **Wrong feedback:** "Not quite. A bibliography says 'I read these things.' An argument says 'these things, taken together, leave this specific opening.' The former is a list. The latter is scholarship."

**Exit:** "Descend to the gallery →" linking to `room4.html`

---

#### Room 4 — The Gallery of Absences

**Theme:** A dark museum gallery with six pedestals. Each pedestal has an empty glass case — the exhibit is what's missing.

**Lecture content:** Six types of gap (Slide 6)

**Environment:**
- Large rectangular room with polished dark floor (slightly reflective), very high ceiling
- Six pedestals arranged in two rows of three (left-front, right-front, left-middle, right-middle, left-back, right-back)
- Each pedestal is a cylinder with a transparent glass box on top (cube with very low opacity)
- Each pedestal has a coloured spotlight from above (different colour per gap type) and a label on the pedestal base
- Gallery title text high on the back wall: "THE GALLERY OF ABSENCES"
- Subtitle: "Six types of gap. Six shapes of what's missing."

**Interaction:**
- Six clickable objects: one per pedestal (invisible click target box around each glass case)
- A counter in the top-left: "Absences examined: 0 / 6"

**Content delivered on click:**

| Pedestal | Label | Colour | Text |
|----------|-------|--------|------|
| 1 | METHOD | Blue-purple | "A known problem that hasn't been approached with this technique. Example: nobody has used diffusion models for live performance audio — they've only been used for offline generation. The problem is known. The tool exists. They haven't been combined." |
| 2 | APPLICATION | Green | "A technique that hasn't been applied in this domain. Example: reinforcement learning is well studied in games but rarely applied to choreographic composition. The method works elsewhere — what happens when you bring it here?" |
| 3 | KNOWLEDGE | Yellow | "Something we don't yet know or understand. Example: we don't know how audiences perceive AI-generated music differently from human-composed music. The question is open. Nobody has answered it." |
| 4 | SCALE | Orange | "Something that works at one scale but hasn't been tested at another. A technique proven on small datasets but never tried at production scale. A prototype that works for one user — what about a hundred?" |
| 5 | CRITICAL | Pink-red | "A framing or assumption that hasn't been questioned. Example: most work on generative art assumes a single author — what happens when authorship is distributed? An orthodoxy hiding in plain sight." |
| 6 | AUDIENCE | Purple | "Work that exists for one community but hasn't reached another. Knowledge trapped in one discipline that another discipline needs. A bridge not yet built." |

**Decision (triggered after all 6 are clicked):**

> **Question:** You've examined all six absences. Now: "Nobody has used diffusion models for live performance audio — they've only been used offline." What type of gap is this?
>
> **Option A:** A knowledge gap — we don't understand something yet. *(wrong)*
>
> **Option B:** A method gap — a known problem, an existing technique, not yet combined. *(correct)*
>
> **Option C:** An audience gap — the work hasn't reached the right people. *(wrong)*
>
> **Option D:** A scale gap — it works at one scale but not another. *(wrong)*
>
> **Correct feedback:** "Correct. The problem is known (live audio). The technique exists (diffusion models). Nobody has combined them. That's a method gap — the opening is in the approach."
>
> **Wrong feedback:** "This is a method gap. The problem (live audio generation) and the technique (diffusion models) both exist — they just haven't been combined. The gap is in the approach."

**Exit:** "Exit the gallery →" linking to `room5.html`

---

#### Room 5 — The Telephone Room

**Theme:** A warm, wallpapered room with five old telephones on small tables. Each phone delivers a strategy for finding gaps.

**Lecture content:** How to find a gap — practical strategies (Slide 7)

**Environment:**
- Square room with dark red-brown wallpapered walls
- Five small side tables, each with a simplified telephone (box body, cylindrical handset)
- Each phone has a small warm light above it and a number label ("1" through "5")
- Central chandelier (warm glowing sphere on ceiling)
- Text on back wall: "PICK UP THE PHONES"
- Overall colour: warm, intimate, slightly unsettling

**Interaction:**
- Five clickable objects: the phone bodies
- Counter in top-left: "Calls received: 0 / 5"

**Content delivered on click:**

| Phone | Text |
|-------|------|
| 1 | "Read the 'future work' sections. Every good paper ends by saying what it didn't do. Those are gaps, pre-identified for you. Start there. It's the easiest strategy and the most underused." |
| 2 | "Read survey papers and literature reviews. These map a field in one document. They're the fastest way to understand what exists and where the edges are. One good survey can save you weeks." |
| 3 | "Follow citation chains. If Paper A cites Paper B, and B cites C — follow the chain. At some point the chain thins out. That thinning is the frontier. That's where you want to be." |
| 4 | "Look at what's exhibited, not just what's published. In creative computing, major artworks often precede papers. Check Ars Electronica, ISEA, NeurIPS Creativity workshops, transmediale, festival archives. Ignoring this is like reviewing physics and only checking half the journals." |
| 5 | "Talk to people. Ask practitioners and researchers what they think is unresolved. You'd be surprised how often the answer is 'nobody has tried that.' The frontier isn't always in the papers. Sometimes it's in the conversations around them." |

**Decision:** None

**Exit:** Appears after all 5 phones are clicked. "Through the mirror →" linking to `room6.html`

---

#### Room 6 — The Mirror Room

**Theme:** A dark room with four large mirrors on the four walls. Each mirror shows a false gap statement.

**Lecture content:** What a gap is NOT (Slide 14)

**Environment:**
- Square room with dark teal/cyan tones, slightly reflective floor
- One large framed rectangle on each wall (front, back, left, right), styled as mirrors (metallic material, low roughness)
- Each mirror has text floating on its surface (the false gap statement in quotes)
- Cool cyan spotlights angled at each mirror
- Title text floating in the centre of the room: "THINGS THAT LOOK LIKE GAPS BUT AREN'T"

**Interaction:**
- Four clickable objects: invisible click targets over each mirror
- No counter needed (only four, manageable)

**Content delivered on click:**

| Mirror | Statement on surface | Speaker label | Text on click |
|--------|---------------------|---------------|---------------|
| 1 (front wall) | "Nobody has done my exact project" | False Gap #1 | "'Nobody has done my exact project.' That's not a gap. That's a description of all possible projects. Of course nobody has done your exact thing — that's trivially true. A gap requires you to say what specific absence in the field's knowledge your project addresses." |
| 2 (right wall) | "I couldn't find any papers" | False Gap #2 | "'I couldn't find any papers on my topic.' That might mean there's a gap, or it might mean you searched badly. If an entire field seems to be missing, you're probably looking in the wrong place — or your topic needs reframing." |
| 3 (back wall) | "This tech is new so everything is a gap" | False Gap #3 | "'This technology is new, so everything about it is a gap.' New technologies still exist within existing conversations. Diffusion models are new, but generative art is sixty years old. The gap is not 'use a new tool' — it's 'use a new tool to do something the old tools couldn't, and explain what that reveals.'" |
| 4 (left wall) | "I'm interdisciplinary so I don't fit any field" | False Gap #4 | "'My project is interdisciplinary, so it doesn't fit any field.' Interdisciplinary work sits at the intersection of multiple fields. You still need to know those fields. Being between fields is not the same as being outside them. It's harder, not easier." |

**Decision:** None

**Exit:** Appears after all 4 mirrors are clicked. "Enter the divided room →" linking to `room7.html`

---

#### Room 7 — The Divided Room

**Theme:** A room split exactly in half. Left side is blue (technical context), right side is red (artistic context). A spinning object sits on the dividing line.

**Lecture content:** Dual context in practice-based research (Slide 15)

**Environment:**
- Rectangular room split down the middle by a thin bright line on the floor
- Left half: blue-tinted floor, blue accent lighting, contains screen/terminal-like objects (boxes representing monitors)
- Right half: red-tinted floor, red accent lighting, contains canvas/frame-like objects (planes representing artworks)
- Labels high on the back wall: "TECHNICAL CONTEXT" (left, blue) and "ARTISTIC CONTEXT" (right, red)
- At the dividing line near the back: a slowly spinning metallic sphere labelled "THE INTERSECTION" with mixed purple light

**Interaction:**
- Five clickable objects: two on the left (technical), two on the right (artistic), one at the centre (the intersection)
- Each has a "?" label

**Content delivered on click:**

| Object | Speaker | Text |
|--------|---------|------|
| Tech 1 (left-back) | Technical Context | "What tools, methods, architectures, or materials exist? What are their capabilities and limitations? This is one half of the picture. You need to know what the machines can do — and where they fail." |
| Tech 2 (left-front) | Technical Context | "In creative computing, the technical literature includes machine learning, computer graphics, HCI, signal processing, and more. These have their own conferences, their own vocabularies, their own standards of evidence." |
| Art 1 (right-back) | Artistic Context | "What has been made? What aesthetic, conceptual, or critical territory has been explored? What hasn't? This is the other half. You need to know what the artists and thinkers have done — and what remains unexamined." |
| Art 2 (right-front) | Artistic Context | "The artistic lineage might include generative art, sound art, net art, expanded cinema, speculative design. Major artworks often precede papers. Check festival archives, not just journals." |
| Intersection (centre) | The Intersection | "Your gap often sits right here — at the intersection. A technical capability that hasn't been explored artistically. An artistic ambition that hasn't been enabled technically. The most productive gaps live where these two contexts fail to meet." |

**Decision (triggered after all 5 objects are clicked):**

> **Question:** Most neural audio synthesis work assumes the output should sound "realistic." This assumption is widespread but rarely questioned. What kind of gap does challenging it open?
>
> **Option A:** A method gap — we need a new technique. *(wrong)*
>
> **Option B:** A critical gap — an unexamined assumption hiding in plain sight. *(correct)*
>
> **Option C:** An application gap — the tech needs a new domain. *(wrong)*
>
> **Correct feedback:** "Yes. An orthodoxy — an assumption so widespread it becomes invisible. Challenging it is where entire new research directions begin. The edge is closer than you think."
>
> **Wrong feedback:** "This is a critical gap. 'Realism' as the default goal is an assumption nobody questions — a hidden orthodoxy. Interrogating it opens a frontier."

**Exit:** "Step outside →" linking to `room8.html`

---

#### Room 8 — The Edge

**Theme:** The climax. A small dark vestibule opens onto an infinite cliff edge. The student stands at the boundary between everything known and everything unknown.

**Lecture content:** The gap statement structure (Slide 11); weekly tasks (Slide 18)

**Environment:**
- Start in a small dark vestibule (4×4 unit box, single overhead light)
- The vestibule opens forward onto a vast flat ground plane that extends about 10 units then **stops abruptly** at a cliff edge
- The edge is marked by a thin bright white/grey line across the full width of the ground
- Beyond the edge: **nothing.** Pure dark void, except for a scattering of distant tiny glowing spheres at varying depths and distances (suggesting stars, or distant knowledge, or unreached territory). Some drift slowly
- The feeling should be vertigo, openness, scale — a hard contrast after seven enclosed rooms
- Floating text above the edge: "THE EDGE" in large, faded, widely-spaced letters
- Below the text near the edge: a bobbing instruction "Stand here. Look out. Click."

**Intro overlay:** A brief black screen before the scene loads:
> "You've walked through seven rooms. You've heard the voices. Seen the absences. Learned to tell the real gaps from the false ones. Now step outside."

**Interaction:**
- One clickable object: an invisible box at the cliff edge
- No counter, no HUD

**Content delivered on click:**

The final message is a larger HTML overlay at the bottom of the screen with two sections:

**Main text:**
> You're standing at the edge. Behind you: everything the field has done. Every paper written, every artwork made, every experiment run, every assumption taken for granted.
>
> In front of you: everything it hasn't.
>
> A gap is not just "nobody has done my project." A gap is a **meaningful absence** — something the field needs, or would benefit from, that doesn't yet exist.
>
> Your gap statement has three parts:
>
> **1. What exists** — what is the state of the field?
> **2. What is missing** — what gap does your project address?
> **3. Why it matters** — what does the field gain?
>
> This is where your research lives. Not behind you in the known. Out there, in the dark, where nobody has been yet.

**Task prompt (below a divider line):**
> For this week: build your reading list. Find at least 5 core papers or works. Extract the five questions for each (question, method, contribution, limitations, relation to your project). Draft a gap statement using the three-part structure above. It doesn't need to be final. It needs to exist.
>
> *Next week: choosing and designing methods. Once you have a gap, you need a way to investigate it.*

**Decision:** None

**Exit:** None. This is the final room.

---

### Visual/Colour Summary

| Room | Dominant colour | Mood |
|------|----------------|------|
| 1 — Red Room | Deep crimson, warm amber | Intimate, ceremonial |
| 2 — Corridor | Dark blue-purple | Uncanny, infinite |
| 3 — Filing Room | Warm amber/sepia | Bureaucratic, eerie |
| 4 — Gallery | Dark with coloured spotlights | Museum, reverent |
| 5 — Telephone Room | Warm red-brown | Intimate, anachronistic |
| 6 — Mirror Room | Dark teal/cyan | Cold, reflective |
| 7 — Divided Room | Blue vs red, split | Dualistic, tension |
| 8 — The Edge | Near-black with distant lights | Vast, vertiginous |

### HTML Overlay Styling Notes

All overlays use `Courier New` monospace, muted colours consistent with each room's palette, and minimal UI. The message box sits at the bottom of the screen. Decision panels are centred. Exit links are top-right with a thin border. Everything should feel like it belongs in the world — no bright whites, no system fonts, no UI that breaks the atmosphere.
