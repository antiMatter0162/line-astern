// Launch menu renderer with separate main-menu and campaign pages.
window.createStartScreen = function createStartScreen(scene, onSelectMode, onExitGame) {
  const width = 1280;
  const height = 800;
  const leftWidth = 430;
  const depth = 100;
  const objects = [];
  const mainPageObjects = [];
  const campaignPageObjects = [];
  let currentPage = "main";
  let chapterExpanded = false;

  const background = scene.add.rectangle(width / 2, height / 2, width, height, 0x071824)
    .setDepth(depth);
  const leftColumn = scene.add.rectangle(leftWidth / 2, height / 2, leftWidth, height, 0x0a202d)
    .setDepth(depth + 1);
  const separator = scene.add.rectangle(leftWidth, height / 2, 3, height, 0x1abc9c)
    .setDepth(depth + 2);
  objects.push(background, leftColumn, separator);

  objects.push(addPixelText(scene, "LINE OF\nBATTLE", 60, 104, 6, 0xe8f4f5, depth + 3));
  const mainSubtitle = addPixelText(scene, "COMMAND THE FLEET", 62, 258, 2, 0x56d8c3, depth + 3);
  const campaignSubtitle = addPixelText(scene, "SELECT A CHAPTER", 62, 258, 2, 0x56d8c3, depth + 3);
  objects.push(mainSubtitle, campaignSubtitle);
  const divider = scene.add.rectangle(60, 302, 300, 2, 0x315260)
    .setOrigin(0, 0.5).setDepth(depth + 3);
  objects.push(divider);
  const mainHeading = addPixelText(scene, "MODES", 62, 337, 2, 0x8baab4, depth + 3);
  const campaignHeading = addPixelText(scene, "CAMPAIGN", 62, 337, 2, 0x8baab4, depth + 3);
  objects.push(mainHeading, campaignHeading);
  mainPageObjects.push(mainSubtitle, mainHeading);
  campaignPageObjects.push(campaignSubtitle, campaignHeading);

  const menuLeft = 60;
  const menuCenterX = menuLeft + 150;
  const campaignButton = scene.add.rectangle(menuCenterX, 399, 300, 58, 0x12584f)
    .setDepth(depth + 3)
    .setInteractive({ useHandCursor: true });
  const campaignLabel = window.PixelFont.create(scene, "> CAMPAIGN", {
    x: menuCenterX,
    y: 399 - 7 * 4 / 2,
    pixelSize: 4,
    color: 0xe8f4f5,
    depth: depth + 4,
    align: "center",
  });
  campaignButton
    .on("pointerover", () => campaignButton.setFillStyle(0x187568))
    .on("pointerout", () => campaignButton.setFillStyle(0x12584f))
    .on("pointerdown", () => {
      currentPage = "campaign";
      chapterExpanded = false;
      refreshPage();
    });
  objects.push(campaignButton, campaignLabel);
  mainPageObjects.push(campaignButton, campaignLabel);

  const chapterButton = scene.add.rectangle(menuCenterX, 399, 300, 58, 0x103746)
    .setDepth(depth + 3)
    .setInteractive({ useHandCursor: true });
  const chapterLabel = window.PixelFont.create(scene, "> CHAPTER 1: PACIFIC SKIRMISH", {
    x: menuCenterX,
    y: 399 - 7 * 1.5 / 2,
    pixelSize: 1.5,
    color: 0xc3d9df,
    depth: depth + 4,
    align: "center",
  });
  chapterButton
    .on("pointerover", () => chapterButton.setFillStyle(0x174b5d))
    .on("pointerout", () => chapterButton.setFillStyle(0x103746))
    .on("pointerdown", () => {
      chapterExpanded = !chapterExpanded;
      refreshPage();
    });
  objects.push(chapterButton, chapterLabel);
  campaignPageObjects.push(chapterButton, chapterLabel);

  const levelRows = Array.from({ length: 5 }, (_, index) => {
    const levelNumber = index + 1;
    const y = 434 + index * 30;
    const enabled = levelNumber === 1;
    const button = scene.add.rectangle(
      menuCenterX + 10,
      y + 14,
      280,
      28,
      enabled ? 0x12584f : 0x263943,
    ).setDepth(depth + 3);
    if (enabled) {
      button.setInteractive({ useHandCursor: true })
        .on("pointerover", () => button.setFillStyle(0x187568))
        .on("pointerout", () => button.setFillStyle(0x12584f))
        .on("pointerdown", () => onSelectMode("1-1"));
    }
    const label = window.PixelFont.create(scene, `LEVEL 1-${levelNumber}`, {
      x: menuCenterX + 10,
      y: y + 7,
      pixelSize: 2,
      color: enabled ? 0xe8f4f5 : 0x71818a,
      depth: depth + 4,
      align: "center",
    });
    objects.push(button, label);
    campaignPageObjects.push(button, label);
    return { button, label };
  });

  const backButton = scene.add.rectangle(menuCenterX, 620, 300, 38, 0x103746)
    .setDepth(depth + 3)
    .setInteractive({ useHandCursor: true })
    .on("pointerover", () => backButton.setFillStyle(0x174b5d))
    .on("pointerout", () => backButton.setFillStyle(0x103746))
    .on("pointerdown", () => {
      currentPage = "main";
      refreshPage();
    });
  const backLabel = window.PixelFont.create(scene, "< BACK TO MENU", {
    x: menuCenterX,
    y: 620 - 7 * 2 / 2,
    pixelSize: 2,
    color: 0xe8f4f5,
    depth: depth + 4,
    align: "center",
  });
  objects.push(backButton, backLabel);
  campaignPageObjects.push(backButton, backLabel);

  function refreshPage() {
    const onMainPage = currentPage === "main";
    mainPageObjects.forEach((object) => object.setVisible(onMainPage));
    campaignPageObjects.forEach((object) => object.setVisible(!onMainPage));
    chapterLabel.setPixelText(`${chapterExpanded ? "v" : ">"} CHAPTER 1: PACIFIC SKIRMISH`);
    levelRows.forEach(({ button, label }) => {
      button.setVisible(!onMainPage && chapterExpanded);
      label.setVisible(!onMainPage && chapterExpanded);
    });
  }
  refreshPage();

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
      refreshPage();
    },
  };
};

function addPixelText(scene, text, x, y, pixelSize, color, depth) {
  return window.PixelFont.create(scene, text, { x, y, pixelSize, color, depth });
}
