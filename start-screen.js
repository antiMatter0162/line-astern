// Launch menu renderer with main-menu, campaign, and boot camp pages.
window.createStartScreen = function createStartScreen(scene, onSelectMode, onExitGame) {
  console.log("levels:", window.LEVEL_DATA.levels.map((l) => l.id));
  const width = 1280;
  const height = 800;
  const leftWidth = 430;
  const depth = 100;
  const objects = [];
  const mainPageObjects = [];
  const campaignPageObjects = [];
  const bootCampPageObjects = [];
  const subPageObjects = [];
  let currentPage = "main";
  let chapterExpanded = false;
  let hoveredLevelId = null;

  function bindLevelHover(button, levelId, enabled) {
    button.setInteractive({ useHandCursor: enabled })
      .on("pointerover", () => {
        if (enabled) button.setFillStyle(0x187568);
        hoveredLevelId = levelId;
        refreshLevelDescription();
      })
      .on("pointerout", () => {
        button.setFillStyle(enabled ? 0x12584f : 0x263943);
        if (hoveredLevelId === levelId) {
          hoveredLevelId = null;
          refreshLevelDescription();
        }
      });
    if (enabled) button.on("pointerdown", () => onSelectMode(levelId));
  }

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
  const bootCampSubtitle = addPixelText(scene, "SELECT A TUTORIAL", 62, 258, 2, 0x56d8c3, depth + 3);
  objects.push(mainSubtitle, campaignSubtitle, bootCampSubtitle);
  const divider = scene.add.rectangle(60, 302, 300, 2, 0x315260)
    .setOrigin(0, 0.5).setDepth(depth + 3);
  objects.push(divider);
  const mainHeading = addPixelText(scene, "MODES", 62, 337, 2, 0x8baab4, depth + 3);
  const campaignHeading = addPixelText(scene, "CAMPAIGN", 62, 337, 2, 0x8baab4, depth + 3);
  const bootCampHeading = addPixelText(scene, "BOOT CAMP", 62, 337, 2, 0x8baab4, depth + 3);
  objects.push(mainHeading, campaignHeading, bootCampHeading);
  mainPageObjects.push(mainSubtitle, mainHeading);
  campaignPageObjects.push(campaignSubtitle, campaignHeading);
  bootCampPageObjects.push(bootCampSubtitle, bootCampHeading);

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

  const bootCampButton = scene.add.rectangle(menuCenterX, 469, 300, 58, 0x12584f)
    .setDepth(depth + 3)
    .setInteractive({ useHandCursor: true });
  const bootCampLabel = window.PixelFont.create(scene, "> BOOT CAMP", {
    x: menuCenterX,
    y: 469 - 7 * 4 / 2,
    pixelSize: 4,
    color: 0xe8f4f5,
    depth: depth + 4,
    align: "center",
  });
  bootCampButton
    .on("pointerover", () => bootCampButton.setFillStyle(0x187568))
    .on("pointerout", () => bootCampButton.setFillStyle(0x12584f))
    .on("pointerdown", () => {
      currentPage = "boot-camp";
      refreshPage();
    });
  objects.push(bootCampButton, bootCampLabel);
  mainPageObjects.push(bootCampButton, bootCampLabel);

  // Placeholder tutorials stay disabled until their level data is available.
  Array.from({ length: 5 }, (_, index) => {
    const levelId = `tutorial_${index + 1}`;
    const y = 399 + index * 40;
    const enabled = window.LEVEL_DATA.levels.some((level) => level.id === levelId);
    const button = scene.add.rectangle(menuCenterX, y, 300, 32,
      enabled ? 0x12584f : 0x263943).setDepth(depth + 3);
    bindLevelHover(button, levelId, enabled);
    const label = window.PixelFont.create(scene, levelId, {
      x: menuCenterX,
      y: y - 7 * 2 / 2,
      pixelSize: 2,
      color: enabled ? 0xe8f4f5 : 0x71818a,
      depth: depth + 4,
      align: "center",
    });
    objects.push(button, label);
    bootCampPageObjects.push(button, label);
  });

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
    const levelId = `1-${levelNumber}`;                                   // NEW
    const y = 434 + index * 30;
    const enabled = window.LEVEL_DATA.levels.some((l) => l.id === levelId); // CHANGED
    const button = scene.add.rectangle(
      menuCenterX + 10,
      y + 14,
      280,
      28,
      enabled ? 0x12584f : 0x263943,
    ).setDepth(depth + 3);
    bindLevelHover(button, levelId, enabled);
    const label = window.PixelFont.create(scene, `LEVEL ${levelId}`, {    // CHANGED (optional, same output)
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
  subPageObjects.push(backButton, backLabel);

  function refreshPage() {
    hoveredLevelId = null;
    refreshLevelDescription();
    const onMainPage = currentPage === "main";
    mainPageObjects.forEach((object) => object.setVisible(onMainPage));
    const onCampaignPage = currentPage === "campaign";
    campaignPageObjects.forEach((object) => object.setVisible(onCampaignPage));
    bootCampPageObjects.forEach((object) => object.setVisible(currentPage === "boot-camp"));
    subPageObjects.forEach((object) => object.setVisible(!onMainPage));
    chapterLabel.setPixelText(`${chapterExpanded ? "v" : ">"} CHAPTER 1: PACIFIC SKIRMISH`);
    levelRows.forEach(({ button, label }) => {
      button.setVisible(onCampaignPage && chapterExpanded);
      label.setVisible(onCampaignPage && chapterExpanded);
    });
  }

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

  const descriptionTitle = addPixelText(scene, "", 600, 305, 3, 0xe8f4f5, depth + 3);
  const descriptionBody = addPixelText(scene, "", 600, 370, 2, 0xc3d9df, depth + 3);
  objects.push(descriptionTitle, descriptionBody);

  function wrapDescription(text, maxCharacters) {
    return String(text).split("\n").map((paragraph) => {
      const words = paragraph.match(new RegExp(`\\S{1,${maxCharacters}}`, "g")) || [];
      const lines = [""];
      words.forEach((word) => {
        const index = lines.length - 1;
        if (lines[index] && lines[index].length + word.length + 1 > maxCharacters) {
          lines.push(word);
        } else {
          lines[index] += `${lines[index] ? " " : ""}${word}`;
        }
      });
      return lines.join("\n");
    }).join("\n");
  }

  function refreshLevelDescription() {
    const hasHover = hoveredLevelId != null;
    signTop.setVisible(!hasHover);
    signTitle.setVisible(!hasHover);
    signRule.setVisible(!hasHover);
    descriptionTitle.setVisible(hasHover);
    descriptionBody.setVisible(hasHover);
    if (!hasHover) return;
    const level = window.LEVEL_DATA.levels.find((candidate) => candidate.id === hoveredLevelId);
    descriptionTitle.setPixelText(wrapDescription(level?.name || hoveredLevelId, 28));
    descriptionBody.setPixelText(wrapDescription(
      level?.description || "Description coming soon.", 42,
    ));
  }
  refreshPage();

  scene.cameras.main.ignore(objects);
  return {
    hide() {
      hoveredLevelId = null;
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
