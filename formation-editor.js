// All visible text uses the game's bitmap glyphs. Placement remains independent
// of formation commands so these controls can be moved into a future HUD.
window.createFormationEditor = function createFormationEditor({ system, getSelection, canEdit }) {
  const font = window.PixelFont;
  const panel = document.createElement("section");
  panel.style.cssText = "position:fixed;left:20px;top:70px;width:600px;max-width:96vw;max-height:85vh;overflow:auto;z-index:1000;background:#102a3a;color:#e8f4f5;border:2px solid #1abc9c;border-radius:0;padding:14px;box-sizing:border-box;display:none";
  panel.setAttribute("aria-label", "Formation editor");
  const header = document.createElement("div");
  header.append(font.createCanvas("FORMATION EDITOR - DRAG TO MOVE"));
  header.style.cssText = "cursor:move;touch-action:none;padding:4px 0 14px;border-bottom:2px solid #315260";
  panel.append(header);
  const content = document.createElement("div");
  panel.append(content);
  document.body.append(panel);
  let visible = false;
  let signature = "";
  let panelDrag = null;
  let gridDrag = null;
  let selectedShip = null;
  let viewedFormation = null;
  let currentGrid = null;
  let range = 600;
  const name = (ship) => ship.name || ship.levelShipId || ship.stats.label;
  const selection = () => getSelection().filter((ship) => !ship.sinking && !ship.sunk);

  for (const event of ["pointerdown", "pointerup", "click", "wheel", "keydown", "keyup", "contextmenu"]) {
    panel.addEventListener(event, (e) => e.stopPropagation());
  }
  panel.addEventListener("contextmenu", (event) => event.preventDefault());
  header.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = panel.getBoundingClientRect();
    panelDrag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    header.setPointerCapture(event.pointerId);
  });
  header.addEventListener("pointermove", (event) => {
    if (panelDrag) setPosition(event.clientX - panelDrag.x, event.clientY - panelDrag.y);
  });
  header.addEventListener("pointerup", () => { panelDrag = null; });
  header.addEventListener("lostpointercapture", () => { panelDrag = null; });

  function text(value, color = "#8baab4") {
    const element = document.createElement("p");
    element.style.cssText = "margin:12px 0;line-height:1";
    element.append(font.createCanvas(value, { color }));
    content.append(element);
    return element;
  }

  function button(label, action, enabled = true, active = false) {
    const element = document.createElement("button");
    element.type = "button";
    element.disabled = !enabled;
    element.setAttribute("aria-label", label);
    element.style.cssText = `appearance:none;border:2px solid ${active ? "#1abc9c" : "#315260"};border-radius:0;background:${active ? "#12584f" : "#0a3d62"};padding:10px;margin:4px 6px 4px 0;cursor:${enabled ? "pointer" : "default"};opacity:${enabled ? 1 : 0.4};max-width:100%`;
    element.append(font.createCanvas(label));
    element.addEventListener("pointerover", () => { if (enabled) element.style.background = "#187568"; });
    element.addEventListener("pointerout", () => { element.style.background = active ? "#12584f" : "#0a3d62"; });
    element.addEventListener("click", () => {
      if (!canEdit() || !enabled) return;
      if (action() !== false) refresh(true);
    });
    content.append(element);
    return element;
  }

  function fit(formation) {
    range = Math.max(600, ...[...formation.slots.values()]
      .map((slot) => Math.max(Math.abs(slot.right), Math.abs(slot.forward)) * 1.3));
    range = Math.ceil(range / 100) * 100;
  }

  function createGrid(formation) {
    const canvas = document.createElement("canvas");
    currentGrid = canvas;
    canvas.width = 560;
    canvas.height = 340;
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "group");
    canvas.setAttribute("aria-label", "Formation grid. Drag a follower to change its station. Arrow keys move the selected follower.");
    canvas.style.cssText = "display:block;width:100%;height:auto;image-rendering:pixelated;touch-action:none;background:#071b2b;border:2px solid #315260;box-sizing:border-box;cursor:grab";
    content.append(canvas);
    const ctx = canvas.getContext("2d");
    const center = { x: 280, y: 170 };
    const scale = () => 140 / range;
    const position = (ship) => {
      const slot = gridDrag?.ship === ship ? gridDrag.slot : formation.slots.get(ship);
      return { x: center.x + slot.right * scale(), y: center.y - slot.forward * scale() };
    };
    const pointer = (event) => {
      const rect = canvas.getBoundingClientRect();
      return { x: (event.clientX - rect.left) * canvas.width / rect.width,
        y: (event.clientY - rect.top) * canvas.height / rect.height };
    };
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#163a4b";
      const spacing = 100 * scale();
      for (let x = center.x % spacing; x < canvas.width; x += spacing) ctx.fillRect(Math.round(x), 0, 1, canvas.height);
      for (let y = center.y % spacing; y < canvas.height; y += spacing) ctx.fillRect(0, Math.round(y), canvas.width, 1);
      ctx.fillStyle = "#287b91";
      ctx.fillRect(center.x, 0, 1, canvas.height);
      ctx.fillRect(0, center.y, canvas.width, 1);
      font.draw(ctx, "FORWARD", { x: 8, y: 8, pixelSize: 1, color: "#8baab4" });
      font.draw(ctx, "RIGHT >", { x: 550, y: 324, pixelSize: 1, align: "right", color: "#8baab4" });
      font.draw(ctx, `GRID: 100 UNITS  SNAP: 50`, { x: 8, y: 324, pixelSize: 1, color: "#8baab4" });
      ctx.imageSmoothingEnabled = false;
      for (const ship of formation.slots.keys()) {
        const p = position(ship);
        const leader = ship === formation.leader;
        const color = leader ? "#ffe778" : system.getMembership(ship)?.detached ? "#8baab4" : "#62f0c8";
        ctx.fillStyle = ship === selectedShip ? "#12584f" : "#102a3a";
        ctx.fillRect(Math.round(p.x - 15), Math.round(p.y - 26), 30, 52);
        ctx.strokeStyle = color;
        ctx.lineWidth = ship === selectedShip ? 2 : 1;
        ctx.strokeRect(Math.round(p.x - 15), Math.round(p.y - 26), 30, 52);
        const image = ship.sprite.scene?.textures.get(ship.stats.textures.hullStationary).getSourceImage();
        if (image) ctx.drawImage(image, Math.round(p.x - 9), Math.round(p.y - 22), 18, 44);
        else {
          ctx.fillStyle = color;
          ctx.fillRect(Math.round(p.x - 5), Math.round(p.y - 18), 10, 36);
          ctx.fillRect(Math.round(p.x - 3), Math.round(p.y - 22), 6, 4);
        }
        const label = `${leader ? "LEADER: " : ""}${name(ship)}`;
        const half = font.measureLine(label, 1) / 2;
        font.draw(ctx, label, { x: Math.max(half + 2, Math.min(canvas.width - half - 2, p.x)),
          y: Math.max(2, Math.min(canvas.height - 24, Math.round(p.y + 29))), align: "center", pixelSize: 1, color });
      }
    }
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !canEdit()) return;
      event.preventDefault();
      canvas.focus();
      const point = pointer(event);
      const hit = [...formation.slots.keys()].reverse().find((ship) => {
        const p = position(ship);
        return Math.abs(point.x - p.x) <= 18 && Math.abs(point.y - p.y) <= 28;
      });
      if (!hit) return;
      selectedShip = hit;
      const slot = formation.slots.get(hit);
      gridDrag = { ship: hit, slot: { ...slot }, start: point, original: { ...slot } };
      canvas.setPointerCapture(event.pointerId);
      draw();
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!gridDrag || !canEdit() || gridDrag.ship === formation.leader) return;
      const point = pointer(event);
      point.x = Math.max(18, Math.min(canvas.width - 18, point.x));
      point.y = Math.max(28, Math.min(canvas.height - 28, point.y));
      // Keep the anchor and zoom stable during a drag; commit only on release.
      gridDrag.slot = {
        right: Math.round((gridDrag.original.right + (point.x - gridDrag.start.x) / scale()) / 50) * 50,
        forward: Math.round((gridDrag.original.forward - (point.y - gridDrag.start.y) / scale()) / 50) * 50,
      };
      draw();
    });
    function finish(commit) {
      if (!gridDrag) return;
      if (commit && canEdit()) system.setSlot(gridDrag.ship, gridDrag.slot.right, gridDrag.slot.forward);
      gridDrag = null;
      refresh(true);
    }
    canvas.addEventListener("pointerup", () => finish(true));
    canvas.addEventListener("pointercancel", () => finish(false));
    canvas.addEventListener("lostpointercapture", () => finish(false));
    canvas.addEventListener("keydown", (event) => {
      const offsets = { ArrowLeft: [-50, 0], ArrowRight: [50, 0], ArrowUp: [0, 50], ArrowDown: [0, -50] };
      const offset = offsets[event.key];
      if (!offset || !canEdit() || selectedShip === formation.leader) return;
      event.preventDefault();
      const slot = formation.slots.get(selectedShip);
      if (slot) system.setSlot(selectedShip, slot.right + offset[0], slot.forward + offset[1]);
      refresh(true);
      currentGrid?.focus();
    });
    draw();
  }

  function refresh(force = false) {
    if (!visible || gridDrag) return;
    const ships = selection();
    const memberships = ships.map((ship) => system.getMembership(ship));
    const formation = memberships.find(Boolean)?.formation;
    const members = formation ? [...formation.slots.keys()] : ships;
    if (!members.includes(selectedShip)) selectedShip = formation?.leader || ships[0] || null;
    const nextSignature = JSON.stringify([ships.map((ship) => [name(ship), system.getMembership(ship)?.formation.id]),
      formation?.id, formation?.phase, formation?.leader.movementStopped, formation ? name(formation.leader) : null,
      members.map((ship) => [name(ship), system.getMembership(ship)?.detached, formation?.slots.get(ship)])]);
    if (!force && signature === nextSignature) return;
    signature = nextSignature;
    if (formation !== viewedFormation) {
      viewedFormation = formation;
      if (formation) fit(formation);
    }
    content.replaceChildren();
    text(`${ships.length} SELECTED. G: EDITOR. R: RETURN TO FORMATION.`);
    button("CREATE FROM SELECTION", () => system.create(ships), ships.length >= 2);
    button("RETURN TO FORMATION", () => system.returnToFormation(ships), memberships.some((member) => member?.detached));
    if (formation) {
      const status = formation.phase === "assembling" ? "FORMING UP"
        : formation.leader.movementStopped ? "STOPPED" : "UNDER WAY";
      text(`FORMATION ${formation.id} - ${status}`, "#56d8c3");
      createGrid(formation);
      button("ZOOM IN", () => { range = Math.max(200, range / 1.5); });
      button("ZOOM OUT", () => { range = Math.min(51200, range * 1.5); });
      button("FIT", () => fit(formation));
      text("LEADER FACES UP. LAYOUT TURNS WITH IT.");
    } else text("SELECT TWO SHIPS AND CREATE A FORMATION.");
    for (const ship of members) {
      const leader = ship === formation?.leader;
      const detached = system.getMembership(ship)?.detached;
      button(`${leader ? "LEADER: " : ""}${name(ship)}${detached ? " - DETACHED" : ""}`,
        () => { selectedShip = ship; }, true, ship === selectedShip);
    }
    if (selectedShip) {
      if (formation) button("MAKE SELECTED SHIP LEADER", () => {
        system.setLeader(formation, selectedShip);
        fit(formation);
      }, selectedShip !== formation.leader);
    }
    if (formation) button("DISBAND FORMATION", () => system.disband(formation));
    button("CLOSE", hide);
  }

  function setPosition(x, y) {
    panel.style.left = `${Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, x))}px`;
    panel.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, y))}px`;
  }
  function hide() {
    visible = false;
    gridDrag = null;
    panel.style.display = "none";
  }
  function show() {
    if (!canEdit()) return;
    visible = true;
    panel.style.display = "block";
    refresh(true);
  }
  return { show, hide, refresh, setPosition,
    toggle: () => visible ? hide() : show(),
    mount: (parent) => parent.append(panel),
  };
};
