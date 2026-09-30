// Launch menu renderer. The mode list is data-driven so additional modes can
// be added here without changing the layout code.
window.createStartScreen = function createStartScreen(scene, onSelectMode, onExitGame) {
  const modes = [
    { id: "standard", label: "PLAY" },
  ];
  const width = 1280;
  const height = 800;
  const leftWidth = 430;
  const depth = 100;
  const objects = [];
  const buttons = [];

  const background = scene.add.rectangle(width / 2, height / 2, width, height, 0x071824)
    .setDepth(depth);
  const leftColumn = scene.add.rectangle(leftWidth / 2, height / 2, leftWidth, height, 0x0a202d)
    .setDepth(depth + 1);
  const separator = scene.add.rectangle(leftWidth, height / 2, 3, height, 0x1abc9c)
    .setDepth(depth + 2);
  objects.push(background, leftColumn, separator);

  objects.push(addPixelText(scene, "LINE OF\nBATTLE", 60, 104, 6, 0xe8f4f5, depth + 3));
  objects.push(addPixelText(scene, "COMMAND THE FLEET", 62, 258, 2, 0x56d8c3, depth + 3));
  const divider = scene.add.rectangle(60, 302, 300, 2, 0x315260)
    .setOrigin(0, 0.5).setDepth(depth + 3);
  objects.push(divider);
  objects.push(addPixelText(scene, "MODES", 62, 337, 2, 0x8baab4, depth + 3));

  modes.forEach((mode, index) => {
    const x = 60;
    const y = 376 + index * 72;
    const button = scene.add.rectangle(x + 150, y + 23, 300, 58, 0x12584f)
      .setDepth(depth + 3)
      .setInteractive({ useHandCursor: true });
    const label = addPixelText(scene, `> ${mode.label}`, x + 82, y + 11, 4, 0xe8f4f5, depth + 4);
    button
      .on("pointerover", () => button.setFillStyle(0x187568))
      .on("pointerout", () => button.setFillStyle(0x12584f))
      .on("pointerdown", () => onSelectMode(mode.id));
    buttons.push(button);
    objects.push(button, label);
  });

  const exitY = 653;
  const exitButtonWidth = 300;
  const exitButtonHeight = 58;
  const exitButtonCenterX = 210;
  const exitButton = scene.add.rectangle(
    exitButtonCenterX,
    exitY + exitButtonHeight / 2,
    exitButtonWidth,
    exitButtonHeight,
    0x7a2828,
  )
    .setDepth(depth + 3)
    .setInteractive({ useHandCursor: true })
    .on("pointerover", () => exitButton.setFillStyle(0x9a3434))
    .on("pointerout", () => exitButton.setFillStyle(0x7a2828))
    .on("pointerdown", () => onExitGame?.());
  const exitLabel = window.PixelFont.create(scene, "> EXIT GAME", {
    x: exitButtonCenterX,
    y: exitY + (exitButtonHeight - 7 * 4) / 2,
    pixelSize: 4,
    color: 0xe8f4f5,
    depth: depth + 4,
    align: "center",
  });
  buttons.push(exitButton);
  objects.push(exitButton, exitLabel);

  objects.push(addPixelText(scene, "FAIR WINDS AND FOLLOWING SEAS", 62, 747, 1, 0x54727d, depth + 3));

  // Keep the right-side art area as a simple placeholder until artwork is ready.
  const portraitPanel = scene.add.rectangle(855, 400, 790, 800, 0x0b2a3a)
    .setStrokeStyle(2, 0x1c4859)
    .setDepth(depth + 1);
  const sign = scene.add.rectangle(855, 400, 590, 250, 0x0a202d)
    .setStrokeStyle(4, 0x315260)
    .setDepth(depth + 2);
  const signTop = addPixelText(scene, "ARTWORK AREA", 784, 350, 2, 0x71909b, depth + 3);
  const signTitle = addPixelText(scene, "PLACEHOLDER", 725, 399, 4, 0xe8f4f5, depth + 3);
  const signRule = scene.add.rectangle(855, 458, 300, 2, 0x1abc9c)
    .setDepth(depth + 3);
  objects.push(portraitPanel, sign, signTop, signTitle, signRule);

  scene.cameras.main.ignore(objects);
  return {
    hide() {
      objects.forEach((object) => object.setVisible(false));
    },
    show() {
      objects.forEach((object) => object.setVisible(true));
    },
  };
};

function addPixelText(scene, text, x, y, pixelSize, color, depth) {
  return window.PixelFont.create(scene, text, { x, y, pixelSize, color, depth });
}
