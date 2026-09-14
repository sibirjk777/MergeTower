(function(){
  'use strict';

  // --- Safe Storage Wrapper ---
  const memoryStore = {};
  let storageOK = true;
  try {
    const testKey = '__mt_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
  } catch(e) { storageOK = false; }

  const safeStorage = {
    getItem(key) {
      if (storageOK) { try { return window.localStorage.getItem(key); } catch(e){} }
      return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
    },
    setItem(key, val) {
      if (storageOK) { try { window.localStorage.setItem(key, val); return; } catch(e){} }
      memoryStore[key] = String(val);
    },
    removeItem(key) {
      if (storageOK) { try { window.localStorage.removeItem(key); return; } catch(e){} }
      delete memoryStore[key];
    }
  };

  // --- Yandex Games Platform Integration ---
  let ysdk = null;
  let yPlayer = null;
  let yCloudReady = false;
  let yAuthorized = false;
  let cloudSyncTimer = null;

  const CLOUD_KEYS = [
    'mergeTowerBest','mergeTowerStars','mergeTowerInventory','mergeTowerOwnedSkins',
    'mergeTowerEquippedSkin','mergeTowerDifficulty','mergeTowerProgressByTier',
    'mergeTowerAchState','mergeTowerDailyClaim','mergeTowerTutorialDone',
    'mergeTowerLang','mergeTowerMusicOff','mergeTowerEndlessSave','mergeTowerLevelSave',
    'mergeTowerMissions','mergeTowerTowerXP','mergeTowerDailyBest',
    'mergeTowerUpgrades','mergeTowerVolMusic','mergeTowerVolSfx','mergeTowerHouse',
    'mergeTowerMascot','mergeTowerLastFortuneDate','mergeTowerFortuneSpinsCount'
  ];
  let currentHouse = safeStorage.getItem('mergeTowerHouse') || 'chrono';
  let currentMascot = safeStorage.getItem('mergeTowerMascot') || 'lumi';

  function collectCloudState() {
    const data = { schema: 2, updatedAt: Date.now(), values: {} };
    CLOUD_KEYS.forEach(k => { data.values[k] = safeStorage.getItem(k); });
    return data;
  }

  async function initYandexPlatform() {
    try {
      if (typeof window.YaGames === 'undefined') return;
      ysdk = await window.YaGames.init();
      try { ysdk?.features?.LoadingAPI?.ready?.(); } catch(e){}
      try {
        yPlayer = await ysdk.getPlayer();
        yCloudReady = !!yPlayer;
      } catch(e) { yPlayer = null; }

      if (yPlayer) {
        try {
          const remote = await yPlayer.getData(['mergeTowerCloud']);
          const cloud = remote?.mergeTowerCloud;
          const localStamp = Number(safeStorage.getItem('mergeTowerCloudUpdatedAt') || 0);
          if (cloud && cloud.values && Number(cloud.updatedAt || 0) > localStamp) {
            Object.keys(cloud.values).forEach(k => {
              if (CLOUD_KEYS.includes(k) && cloud.values[k] !== null && cloud.values[k] !== undefined) {
                safeStorage.setItem(k, cloud.values[k]);
              }
            });
            safeStorage.setItem('mergeTowerCloudUpdatedAt', String(cloud.updatedAt));
            reloadPersistentState();
          }
          yCloudReady = true;
        } catch(e){}
      }
      platformStatus(yCloudReady ? t('cloudSaved') : t('cloudGuest'));
    } catch(e) {
      platformStatus(t('cloudGuest'));
    }
  }

  function reloadPersistentState() {
    best = parseInt(safeStorage.getItem('mergeTowerBest') || '0', 10);
    starCoins = parseInt(safeStorage.getItem('mergeTowerStars') || '0', 10);
    inventory = loadInventory();
    ownedSkins = loadOwnedSkins();
    equippedSkin = safeStorage.getItem('mergeTowerEquippedSkin') || 'default';
    difficultyState = loadDifficultyState();
    pathProgressAll = loadProgress();
    achState = loadAchState();
    missionState = loadMissionState();
    currentHouse = safeStorage.getItem('mergeTowerHouse') || 'chrono';
    currentMascot = safeStorage.getItem('mergeTowerMascot') || 'lumi';
    currentLang = safeStorage.getItem('mergeTowerLang') || 'ru';
    document.getElementById('bestVal').textContent = best;
    applyLanguage();
    updateStarsUI();
    updateAchievementsBadge();
    updateMissionsBadge();
    updateDailyBonusUI();
    renderDifficultyRow();
    renderMissions();
    renderTower();
  }

  function platformStatus(msg) {
    const el = document.getElementById('platformNote');
    if (el) el.textContent = msg || '';
  }

  function queueCloudSave(force = false) {
    if (!yPlayer) return;
    clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(async () => {
      try {
        const state = collectCloudState();
        await yPlayer.setData({ mergeTowerCloud: state }, !!force);
        safeStorage.setItem('mergeTowerCloudUpdatedAt', String(state.updatedAt));
        platformStatus(t('cloudSaved'));
      } catch(e){}
    }, force ? 0 : 8000);
  }

  async function requestYandexAuthorization() {
    if (!ysdk) return false;
    try {
      if (yPlayer && yPlayer.isAuthorized && yPlayer.isAuthorized()) return true;
      if (ysdk.auth && typeof ysdk.auth.openAuthDialog === 'function') {
        await ysdk.auth.openAuthDialog();
        yPlayer = await ysdk.getPlayer();
        yAuthorized = !!(yPlayer && yPlayer.isAuthorized && yPlayer.isAuthorized());
        if (yAuthorized) {
          await yPlayer.setData({ mergeTowerCloud: collectCloudState() }, true);
          platformStatus(t('cloudSaved'));
        }
        return yAuthorized;
      }
    } catch(e){}
    return false;
  }

  async function submitYandexLeaderboard(scoreVal, board = 'merge_tower_score') {
    if (!ysdk || !scoreVal) return;
    try {
      if (yPlayer && yPlayer.isAuthorized && yPlayer.isAuthorized()) {
        await ysdk.leaderboards?.setScore(board, Math.max(0, Math.floor(scoreVal)));
        platformStatus(t('scoreSubmitted'));
      }
    } catch(e){}
  }

  function showRewardedStars() {
    if (!ysdk?.adv?.showRewardedVideo) {
      addStars(15);
      platformStatus(t('rewardReceived'));
      return;
    }
    let rewarded = false;
    try {
      ysdk.adv.showRewardedVideo({
        callbacks: {
          onOpen: () => { running = false; try{ actx && actx.suspend(); }catch(e){} },
          onRewarded: () => {
            if (!rewarded) {
              rewarded = true;
              addStars(15);
              queueCloudSave(true);
              platformStatus(t('rewardReceived'));
            }
          },
          onClose: () => {
            try{ actx && actx.resume(); }catch(e){}
            if (!gameOver && currentBall) running = true;
          },
          onError: () => {
            try{ actx && actx.resume(); }catch(e){}
            if (!gameOver && currentBall) running = true;
          }
        }
      });
    } catch(e) {
      if (!gameOver && currentBall) running = true;
    }
  }

  function showYandexFullscreenAd() {
    if (!ysdk?.adv?.showFullscreenAdv) return;
    try {
      const wasRunning = running;
      running = false;
      try{ actx && actx.suspend(); }catch(e){}
      ysdk.adv.showFullscreenAdv({
        callbacks: {
          onClose: () => {
            try{ actx && actx.resume(); }catch(e){}
            if (wasRunning && !gameOver && !goalAchieved) running = true;
          },
          onError: () => {
            try{ actx && actx.resume(); }catch(e){}
            if (wasRunning && !gameOver && !goalAchieved) running = true;
          }
        }
      });
    } catch(e) {
      if (!gameOver && !goalAchieved) running = true;
    }
  }

  // --- Localization ---
  const STRINGS = {
    settingsTitle: { ru: 'Настройки', en: 'Settings' },
    soundLabel: { ru: 'Звук', en: 'Sound' },
    langLabel: { ru: 'Язык', en: 'Language' },
    on: { ru: 'Вкл', en: 'On' },
    off: { ru: 'Выкл', en: 'Off' },
    resume: { ru: 'Продолжить', en: 'Resume' },
    exitToMenu: { ru: 'Выйти в меню', en: 'Exit to Menu' },
    closeApp: { ru: 'Закрыть игру', en: 'Close Game' },
    closeAppNote: { ru: 'Прогресс сохранён — можно закрыть вкладку.', en: 'Progress saved — you can close the tab.' },
    gameTitle: { ru: 'MERGE TOWER', en: 'MERGE TOWER' },
    tagline1: { ru: 'Соединяй одинаковые шары — рождай новые.', en: 'Merge matching balls to create new ones.' },
    tagline2: { ru: 'Не дай башне переполниться!', en: "Don't let the tower overflow!" },
    endlessMode: { ru: 'Бесконечный', en: 'Endless' },
    pathMode: { ru: 'Путь', en: 'Path' },
    startHint: { ru: 'Двигай пальцем / мышью, чтобы прицелиться, отпусти — уронить', en: 'Drag to aim, release to drop' },
    scoreLabel: { ru: 'Счёт', en: 'Score' },
    nextLabel: { ru: 'Далее', en: 'Next' },
    bestLabel: { ru: 'Рекорд', en: 'Best' },
    chooseLevel: { ru: 'Выбери уровень', en: 'Choose Level' },
    back: { ru: '← Назад', en: '← Back' },
    shrinkTooltip: { ru: 'Уменьшить выбранный шар', en: 'Shrink target ball' },
    bombTooltip: { ru: 'Взорвать выбранный шар', en: 'Bomb target ball' },
    swapTooltip: { ru: 'Поменять текущий шар со следующим', en: 'Swap current and next ball' },
    shopTitle: { ru: 'Магазин', en: 'Shop' },
    shopPlus: { ru: '+Ещё', en: '+More' },
    achTitle: { ru: 'Достижения', en: 'Achievements' },
    dailyBonus: { ru: 'Забрать ежедневный бонус (+8★)', en: 'Claim Daily Bonus (+8★)' },
    dailyChallenge: { ru: 'Испытание дня', en: 'Daily Challenge' },
    dailyDesc: { ru: 'Одинаковая последовательность шаров для всех игроков. Победи рекорд дня!', en: 'Identical ball sequence for everyone today. Beat the highscore!' },
    startDaily: { ru: 'Начать испытание', en: 'Start Challenge' },
    dailyBestLabel: { ru: 'Лучший результат дня:', en: 'Daily Best:' },
    missions: { ru: 'Задания', en: 'Missions' },
    missionsDesc: { ru: 'Три ежедневных задания. Выполняй и забирай звёзды!', en: 'Three daily missions. Complete and claim stars!' },
    missionClaim: { ru: 'Забрать', en: 'Claim' },
    missionClaimed: { ru: '✔ Получено', en: '✔ Claimed' },
    missionReady: { ru: 'Награда готова!', en: 'Reward ready!' },
    missionAllDone: { ru: 'Все выполнены!', en: 'All completed!' },
    missionMergesName: { ru: 'Мастер слияний', en: 'Merge Master' },
    missionMergesDesc: { ru: 'Сделай 10 слияний', en: 'Make 10 merges' },
    missionScoreName: { ru: 'Звёздный разгон', en: 'Cosmic Score' },
    missionScoreDesc: { ru: 'Набери 500 очков', en: 'Score 500 points' },
    missionLevelName: { ru: 'Сфера Титана', en: 'Titan Sphere' },
    missionLevelDesc: { ru: 'Создай шар 5 уровня', en: 'Create level 5 sphere' },
    towerMeta: { ru: 'Башня', en: 'Tower' },
    towerDesc: { ru: 'Слияния наполняют башню силой. Чем выше уровень, тем величественнее твоя цитадель.', en: 'Every merge powers up the tower. Upgrade to unlock glory.' },
    towerPerksTitle: { ru: 'Перки Цитадели', en: 'Citadel Perks' },
    towerPerksSub: { ru: 'Пассивные бонусы', en: 'Passive bonuses' },
    cloudBtn: { ru: '☁️ Облако и вход', en: '☁️ Cloud & Sign In' },
    leaderboardBtn: { ru: '🏆 Таблица рекордов', en: '🏆 Leaderboards' },
    cloudSaved: { ru: '☁️ Прогресс в облаке сохранён', en: '☁️ Cloud progress saved' },
    cloudGuest: { ru: 'Локальное сохранение активно', en: 'Local save active' },
    rewardReceived: { ru: 'Награда получена: +15★', en: 'Reward received: +15★' },
    rewardAd: { ru: 'Посмотреть рекламу (+15★)', en: 'Watch ad (+15★)' },
    tutDrag: { ru: 'Веди пальцем влево-вправо, чтобы прицелиться', en: 'Drag left/right to aim' },
    tutRelease: { ru: 'Отпусти — и шар упадёт вниз', en: 'Release to drop the ball' },
    tutSkip: { ru: 'Понятно, играть →', en: 'Got it, Play →' },
    scoreSubmitted: { ru: 'Рекорд отправлен в таблицу!', en: 'Score submitted to leaderboard!' },
    mascot_lumi: { ru: 'Люми (Дух)', en: 'Lumi (Wisp)' },
    mascot_bot: { ru: 'Нова (Бот)', en: 'Nova (Droid)' },
    mascot_dragon: { ru: 'Эфир (Дракон)', en: 'Aether (Drake)' },
    mascot_knight: { ru: 'Орион (Рыцарь)', en: 'Orion (Knight)' },
    mascot_name_lumi: { ru: 'Люми', en: 'Lumi' },
    mascot_role_lumi: { ru: 'Дух Света', en: 'Astral Spirit' },
    mascot_name_bot: { ru: 'Нова', en: 'Nova' },
    mascot_role_bot: { ru: 'Кибер-Бот', en: 'Astro Droid' },
    mascot_name_dragon: { ru: 'Эфир', en: 'Aether' },
    mascot_role_dragon: { ru: 'Дракон', en: 'Star Drake' },
    mascot_name_knight: { ru: 'Орион', en: 'Orion' },
    mascot_role_knight: { ru: 'Рыцарь', en: 'Star Knight' },
    levelPassed: { ru: 'УРОВЕНЬ ПРОЙДЕН!', en: 'LEVEL COMPLETE!' },
    levelFailed: { ru: 'БАШНЯ ПЕРЕПОЛНЕНА', en: 'TOWER OVERFLOWED' },
    playAgain: { ru: 'Ещё раз', en: 'Play Again' },
    nextLevel: { ru: 'Дальше →', en: 'Next →' },
    levels: { ru: 'Уровни', en: 'Levels' },
    optionsTitle: { ru: 'ОПЦИИ', en: 'OPTIONS' },
    warningTitle: { ru: 'ВНИМАНИЕ', en: 'WARNING' },
    completeTitle: { ru: 'ПОБЕДА', en: 'COMPLETE' },
    gameOverTitle: { ru: 'ИГРА ОКОНЧЕНА', en: 'GAME OVER' },
    upgradesTitle: { ru: 'ПРОКАЧКА', en: 'UPGRADES' },
    mapTitle: { ru: 'КАРТА', en: 'MAP' },
    helpTitle: { ru: 'КАК ИГРАТЬ', en: 'HELP' },
    quitPrompt: { ru: 'Уверен, что хочешь выйти в меню? Текущий раунд башни будет завершён!', en: 'Are you sure you want to exit to menu? Current round will end!' },
    cancel: { ru: 'Отмена', en: 'Cancel' },
    quitOk: { ru: 'Выйти', en: 'Exit' },
    restart: { ru: 'Заново', en: 'Restart' },
    musicLabel: { ru: 'Музыка', en: 'Music' },
    mergesLabel: { ru: 'Слияния', en: 'Merges' },
    rewardLabel: { ru: 'Награда', en: 'Reward' },
    towerOverflow: { ru: 'Башня переполнилась!', en: 'Tower overflowed!' },
    rewardAdBtn: { ru: '🎬 +15★ Посмотреть рекламу', en: '🎬 +15★ Watch Ad' },
    retryBtn: { ru: 'Попробовать снова', en: 'Try Again' },
    nextLevelBtn: { ru: 'Следующий уровень', en: 'Next Level' },
    homeBtn: { ru: 'В меню', en: 'Menu' },
    mapBtn: { ru: 'Карта', en: 'Map' },
    backToMenu: { ru: 'В меню', en: 'To Menu' },
    ok: { ru: 'Готово', en: 'OK' },
    nudgeTooltip: { ru: 'Толчок башни (встряхнуть шары)', en: 'Nudge Tower (shake balls)' },
    helpRule1: { ru: '🎯 <b>Слияние:</b> направляй и сбрасывай шар. Два одинаковых шара при контакте объединяются в один более ценный и крупный.', en: '🎯 <b>Merge:</b> Aim and drop balls. Two matching balls merge into a larger, more valuable sphere.' },
    helpRule2: { ru: '📳 <b>Толчок башни:</b> если шары застряли, используй кнопку толчка — импульс встряхнет башню и сдвинет шары к слиянию!', en: '📳 <b>Tower Nudge:</b> If balls get stuck, use the nudge button to give the tower an impulse and shake them together!' },
    helpRule3: { ru: '⚡ <b>Каскадные комбо:</b> соединяй шары подряд! Каждое быстрое комбо умножает очки и ускоряет прогресс башни.', en: '⚡ <b>Cascade Combos:</b> Chain merges rapidly! Each combo multiplies your points and charges the tower.' },
    helpRule4: { ru: '🔮 <b>Джокер:</b> шар со звездой ✦ соединяется с абсолютно любым шаром, спасая в самых критических ситуациях.', en: '🔮 <b>Wildcard:</b> The star ball ✦ merges with ANY ball on contact, saving tight jams.' },
    helpRule5: { ru: '🛠️ <b>Инструменты:</b> уменьшай громоздкие шары (🔧), взрывай мешающие (💣) и меняй местами текущий и следующий шар (🔄).', en: '🛠️ <b>Tools:</b> Shrink giant balls (🔧), bomb hazards (💣), and swap current ball (🔄).' },
    feverLabel: { ru: 'ЛИХОРАДКА', en: 'FEVER' },
    rescueTitle: { ru: 'СПАСЕНИЕ БАШНИ', en: 'RESCUE TOWER' },
    rescueDesc: { ru: 'Коллапс неизбежен! Активируй Сингулярность, чтобы поглотить верхние сферы и спасти свой рекорд!', en: 'Collapse imminent! Activate Singularity to absorb top spheres and continue your record!' },
    rescueBtn: { ru: '🎬 СПАСТИ БАШНЮ', en: '🎬 RESCUE TOWER' },
    rescueSkipBtn: { ru: 'Сдаться', en: 'Give Up' },
    fortuneTitle: { ru: 'АЛТАРЬ ЗВЁЗДНОЙ ФОРТУНЫ', en: 'CELESTIAL WHEEL' },
    fortuneDesc: { ru: 'Испытай космическую удачу! Вращай алтарь и получай звёзды и редкие артефакты.', en: 'Test cosmic luck! Spin the celestial wheel for stars and rare artifacts.' },
    fortuneSpinFree: { ru: '🎁 ВРАЩАТЬ (БЕСПЛАТНО)', en: '🎁 SPIN (FREE)' },
    fortuneSpinAd: { ru: '🎬 ВРАЩАТЬ ЗА РЕКЛАМУ', en: '🎬 SPIN (WATCH AD)' },
    fortuneSpinning: { ru: 'ВРАЩЕНИЕ...', en: 'SPINNING...' },
    fortuneJackpot: { ru: 'СУПЕР-ДЖЕКПОТ!', en: 'SUPER JACKPOT!' },
    fortuneReward: { ru: 'Награда:', en: 'Reward:' },
    feverActiveMsg: { ru: '🔥 ЛИХОРАДКА! ОЧКИ ×3! 🔥', en: '🔥 FEVER! ×3 POINTS! 🔥' },
    rescueSavedMsg: { ru: '💥 БАШНЯ СПАСЕНА! 💥', en: '💥 TOWER SAVED! 💥' },
    house_chrono_desc: { ru: '⚜️ Искажение Времени: +35% комбо-окно, +20% время реакции', en: '⚜️ Time Dilation: +35% combo window, +20% reaction time' },
    house_singularity_desc: { ru: '🕳️ Гравитационный Резонанс: воронка при толчке, +15% очков за сферы 5+ ур.', en: '🕳️ Gravity Surge: vortex on nudge, +15% pts for tier 5+ orbs' },
    house_pulsar_desc: { ru: '☀️ Плазменный Всплеск: +30% к скорости Лихорадки, +10% к очкам', en: '☀️ Plasma Flare: +30% faster Fever charge, +10% merge bonus' },
    house_nebula_desc: { ru: '🪸 Квантовый Росток: повышенный шанс Джокеров, +1★ каждые 10 слияний', en: '🪸 Quantum Sprout: higher Wildcard rate, +1★ every 10 merges' },
    loc_forge: { ru: 'Кузница Пульсаров', en: 'Pulsar Forge' },
    tripleMerge: { ru: '×3 Слияние!', en: '×3 Merge!' },
    chain_label: { ru: '⚡ Цепь ×', en: '⚡ Chain ×' }
  };

  let currentLang = safeStorage.getItem('mergeTowerLang') || 'ru';
  function t(key) {
    const entry = STRINGS[key];
    if (!entry) return key;
    return entry[currentLang] || entry.ru;
  }

  function applyLanguage() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      el.innerHTML = t(key);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = t(el.getAttribute('data-i18n-title'));
    });
    const ruBtn = document.getElementById('langRuBtn');
    const enBtn = document.getElementById('langEnBtn');
    if (ruBtn) ruBtn.style.borderColor = currentLang === 'ru' ? '#4deeea' : '';
    if (enBtn) enBtn.style.borderColor = currentLang === 'en' ? '#4deeea' : '';
    updateMusicBtn();
    if (typeof updateHouseActiveBadge === 'function') updateHouseActiveBadge();
  }

  function setLanguage(lang) {
    currentLang = lang;
    safeStorage.setItem('mergeTowerLang', lang);
    applyLanguage();
    queueCloudSave();
  }

  // --- Ball Levels & Aesthetics ---
  const LEVELS = [
    { r: 16, color: '#4deeea', glow: 'rgba(77,238,234,0.7)', label: '1' },
    { r: 21, color: '#4dc9ea', glow: 'rgba(77,201,234,0.7)', label: '2' },
    { r: 26, color: '#6a9bff', glow: 'rgba(106,155,255,0.7)', label: '3' },
    { r: 32, color: '#9a7bff', glow: 'rgba(154,123,255,0.7)', label: '4' },
    { r: 39, color: '#c96bf2', glow: 'rgba(201,107,242,0.7)', label: '5' },
    { r: 47, color: '#f25bd0', glow: 'rgba(242,91,208,0.7)', label: '6' },
    { r: 56, color: '#ff3d9a', glow: 'rgba(255,61,154,0.75)', label: '7' },
    { r: 66, color: '#ff5f6d', glow: 'rgba(255,95,109,0.75)', label: '8' },
    { r: 77, color: '#ff9f43', glow: 'rgba(255,159,67,0.8)', label: '9' },
    { r: 89, color: '#ffd23f', glow: 'rgba(255,210,63,0.9)', label: '★' },
  ];

  // --- Locations & Path Mode ---
  const LOCATIONS = [
    { id: 'space', name: 'Неоновый космос', nameEn: 'Neon Cosmos', icon: '🌌',
      bgTube: 'linear-gradient(180deg, rgba(22,27,61,0.35) 0%, rgba(10,14,39,0.7) 100%)',
      pageGlow: '#161b3d', starColor: '180,200,255', accent: '#4deeea', ambient: 'nebula' },
    { id: 'reef', name: 'Коралловый риф', nameEn: 'Coral Reef', icon: '🐚',
      bgTube: 'linear-gradient(180deg, rgba(8,45,50,0.4) 0%, rgba(4,20,26,0.75) 100%)',
      pageGlow: '#0b3038', starColor: '140,255,230', accent: '#2dd4bf', ambient: 'bubbles' },
    { id: 'candy', name: 'Конфетный край', nameEn: 'Candy Kingdom', icon: '🍬',
      bgTube: 'linear-gradient(180deg, rgba(52,20,48,0.4) 0%, rgba(26,8,28,0.75) 100%)',
      pageGlow: '#3a1030', starColor: '255,190,230', accent: '#ff6fb0', ambient: 'confetti' },
    { id: 'aurora', name: 'Полярное сияние', nameEn: 'Aurora Borealis', icon: '🌠',
      bgTube: 'linear-gradient(180deg, rgba(16,40,60,0.4) 0%, rgba(6,16,30,0.75) 100%)',
      pageGlow: '#0e2a44', starColor: '170,255,210', accent: '#7fffd4', ambient: 'snow', waves: true },
    { id: 'forge', name: 'Кузница Пульсаров', nameEn: 'Pulsar Forge', icon: '⚡',
      bgTube: 'linear-gradient(180deg, rgba(65,18,8,0.45) 0%, rgba(26,7,3,0.8) 100%)',
      pageGlow: '#3d1608', starColor: '255,180,80', accent: '#f59e0b', ambient: 'embers' },
  ];

  const PATH_LEVELS = [
    { loc:0, type:'reachLevel', target:2, labelRu:'Собери шар «3»', labelEn:'Reach ball "3"' },
    { loc:0, type:'mergeCount', target:8, labelRu:'Сделай 8 слияний', labelEn:'Make 8 merges' },
    { loc:0, type:'reachLevel', target:3, labelRu:'Собери шар «4»', labelEn:'Reach ball "4"' },
    { loc:0, type:'mergeCount', target:12, labelRu:'Сделай 12 слияний', labelEn:'Make 12 merges' },
    { loc:0, type:'reachLevel', target:4, labelRu:'Собери шар «5»', labelEn:'Reach ball "5"' },
    { loc:0, type:'mergeCount', target:18, labelRu:'Сделай 18 слияний', labelEn:'Make 18 merges' },

    { loc:1, type:'reachLevel', target:3, labelRu:'Собери шар «4»', labelEn:'Reach ball "4"' },
    { loc:1, type:'mergeCount', target:12, labelRu:'Сделай 12 слияний', labelEn:'Make 12 merges' },
    { loc:1, type:'reachLevel', target:4, labelRu:'Собери шар «5»', labelEn:'Reach ball "5"' },
    { loc:1, type:'mergeCount', target:16, labelRu:'Сделай 16 слияний', labelEn:'Make 16 merges' },
    { loc:1, type:'reachLevel', target:5, labelRu:'Собери шар «6»', labelEn:'Reach ball "6"' },
    { loc:1, type:'mergeCount', target:22, labelRu:'Сделай 22 слияния', labelEn:'Make 22 merges' },

    { loc:2, type:'reachLevel', target:4, labelRu:'Собери шар «5»', labelEn:'Reach ball "5"' },
    { loc:2, type:'mergeCount', target:15, labelRu:'Сделай 15 слияний', labelEn:'Make 15 merges' },
    { loc:2, type:'reachLevel', target:5, labelRu:'Собери шар «6»', labelEn:'Reach ball "6"' },
    { loc:2, type:'mergeCount', target:20, labelRu:'Сделай 20 слияний', labelEn:'Make 20 merges' },
    { loc:2, type:'reachLevel', target:6, labelRu:'Собери шар «7»', labelEn:'Reach ball "7"' },
    { loc:2, type:'mergeCount', target:26, labelRu:'Сделай 26 слияний', labelEn:'Make 26 merges' },

    { loc:3, type:'reachLevel', target:5, labelRu:'Собери шар «6»', labelEn:'Reach ball "6"' },
    { loc:3, type:'mergeCount', target:18, labelRu:'Сделай 18 слияний', labelEn:'Make 18 merges' },
    { loc:3, type:'reachLevel', target:6, labelRu:'Собери шар «7»', labelEn:'Reach ball "7"' },
    { loc:3, type:'mergeCount', target:24, labelRu:'Сделай 24 слияния', labelEn:'Make 24 merges' },
    { loc:3, type:'reachLevel', target:7, labelRu:'Собери шар «8»', labelEn:'Reach ball "8"' },
    { loc:3, type:'mergeCount', target:30, labelRu:'Сделай 30 слияний', labelEn:'Make 30 merges' },

    { loc:4, type:'reachLevel', target:6, labelRu:'Собери шар «7»', labelEn:'Reach ball "7"' },
    { loc:4, type:'mergeCount', target:22, labelRu:'Сделай 22 слияния', labelEn:'Make 22 merges' },
    { loc:4, type:'reachLevel', target:7, labelRu:'Собери шар «8»', labelEn:'Reach ball "8"' },
    { loc:4, type:'mergeCount', target:28, labelRu:'Сделай 28 слияний', labelEn:'Make 28 merges' },
    { loc:4, type:'reachLevel', target:8, labelRu:'Собери шар «9»', labelEn:'Reach ball "9"' },
    { loc:4, type:'mergeCount', target:36, labelRu:'Сделай 36 слияний', labelEn:'Make 36 merges' },
  ];

  const DIFFICULTIES = [
    { id: 'easy', name: 'Лёгкий', nameEn: 'Easy', icon: '🌱', targetMult: 0.75, rewardMult: 0.85 },
    { id: 'normal', name: 'Стандарт', nameEn: 'Normal', icon: '⚔️', targetMult: 1.0, rewardMult: 1.0 },
    { id: 'expert', name: 'Эксперт', nameEn: 'Expert', icon: '🔥', targetMult: 1.35, rewardMult: 1.5 },
  ];

  function loadDifficultyState() {
    try {
      const raw = safeStorage.getItem('mergeTowerDifficulty');
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.current === 'number' && typeof s.unlocked === 'number') return s;
      }
    } catch(e){}
    return { current: 1, unlocked: 1 };
  }
  let difficultyState = loadDifficultyState();
  function currentDifficulty() { return DIFFICULTIES[difficultyState.current]; }
  function scaledTarget(raw) { return Math.max(1, Math.round(raw * currentDifficulty().targetMult)); }

  function loadProgress() {
    try {
      const raw = safeStorage.getItem('mergeTowerProgressByTier');
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') {
          DIFFICULTIES.forEach(d => {
            if (!Array.isArray(obj[d.id])) {
              obj[d.id] = PATH_LEVELS.map(() => false);
            } else if (obj[d.id].length < PATH_LEVELS.length) {
              // Safely preserve player progress and pad for new levels
              while (obj[d.id].length < PATH_LEVELS.length) {
                obj[d.id].push(false);
              }
            }
          });
          return obj;
        }
      }
    } catch(e){}
    const fresh = {};
    DIFFICULTIES.forEach(d => { fresh[d.id] = PATH_LEVELS.map(() => false); });
    return fresh;
  }
  let pathProgressAll = loadProgress();
  function pathProgress() { return pathProgressAll[currentDifficulty().id]; }
  function isLevelUnlocked(i) { return i === 0 || pathProgress()[i - 1] === true; }

  // --- Physics & Canvas ---
  const GRAVITY = 0.52;
  const WALL_RESTITUTION = 0.32;
  const BALL_RESTITUTION = 0.25;
  const AIR_DAMPING = 0.998;
  const SUBSTEPS = 4; // Multi-pass constraint solver prevents jitter

  let locGravityMult = 1, locRestitutionMult = 1, locFloorFriction = 0.92;
  let balls = [];
  let ballIdCounter = 1;

  function makeBall(x, y, r, level) {
    return {
      id: ballIdCounter++,
      position: { x, y },
      velocity: { x: 0, y: 0 },
      circleRadius: r,
      mass: r * r,
      angle: 0,
      gameLevel: level,
      label: 'ball_' + level,
      isStatic: false,
      isFalling: false,
      spawnAt: null,
      settleRefPos: null,
      settleRefTime: 0,
      isSettled: false,
      squash: 0
    };
  }

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const stageWrap = document.getElementById('stage-wrap');
  const stageInner = document.getElementById('stage-inner');
  const dangerLineEl = document.getElementById('dangerLine');

  let W = 360, H = 480;
  let TUBE_MARGIN = 14;
  let TUBE_TOP = 64;
  let dangerY = 160;

  function sizeCanvas() {
    const wrapW = stageWrap.clientWidth || 360;
    const wrapH = stageWrap.clientHeight || 480;
    const maxW = Math.min(wrapW - 8, 440);
    const maxH = wrapH - 8;

    let w = maxW;
    let h = Math.min(maxH, w * 1.35);
    w = Math.min(w, h / 1.35);
    W = Math.floor(w);
    H = Math.floor(h);

    canvas.width = W;
    canvas.height = H;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    stageInner.style.width = W + 'px';
    stageInner.style.height = H + 'px';

    TUBE_TOP = Math.round(Math.min(74, Math.max(54, H * 0.11)));
    dangerY = TUBE_TOP + Math.max(54, Math.round((H - TUBE_TOP) * 0.23));

    dangerLineEl.style.top = dangerY + 'px';
    dangerLineEl.style.width = W + 'px';
  }

  window.addEventListener('resize', () => {
    sizeCanvas();
    initStars();
    initAmbient();
  });

  // --- Game State Variables ---
  let score = 0;
  let best = parseInt(safeStorage.getItem('mergeTowerBest') || '0', 10);
  let starCoins = parseInt(safeStorage.getItem('mergeTowerStars') || '0', 10);
  let gameMode = 'endless';
  let currentPathLevel = -1;
  let mergesCount = 0;
  let dropMergeChain = 0;
  let lastDropMergeTime = 0;
  let highestLevel = 0;
  let goalAchieved = false;
  let gameOver = false;
  let running = false;
  let canDrop = true;
  let currentBall = null;
  let aimX = 0;
  let dangerTimer = 0;
  const DANGER_LIMIT = 85;
  let dangerProximity = 0;
  let lastDangerBeatTime = 0;
  let particles = [];
  let floatingTexts = [];
  let shakeAmount = 0;
  let comboCount = 0;
  let comboTimer = 0;
  const COMBO_WINDOW = 48;
  let newRecordThisRun = false;
  let toolsUsedThisLevel = 0;

  // --- Inventory & Skins ---
  const TOOL_COST = { shrink: 4, bomb: 6, swap: 3 };
  function loadInventory() {
    try {
      const raw = safeStorage.getItem('mergeTowerInventory');
      if (raw) return JSON.parse(raw);
    } catch(e){}
    return { shrink: 1, bomb: 1, swap: 1 };
  }
  let inventory = loadInventory();
  function saveInventory() { safeStorage.setItem('mergeTowerInventory', JSON.stringify(inventory)); queueCloudSave(); }

  const SKINS = [
    { id: 'default', name: 'Обычный', nameEn: 'Classic', cost: 0, desc: 'Под цвет локации' },
    { id: 'rainbow', name: 'Радужный', nameEn: 'Rainbow', cost: 35, desc: 'Переливается цветами' },
    { id: 'gold', name: 'Золотой', nameEn: 'Golden', cost: 50, desc: 'Блестящий металл' },
    { id: 'shadow', name: 'Теневой', nameEn: 'Shadow', cost: 45, desc: 'Таинственное сияние' },
  ];
  function loadOwnedSkins() {
    try {
      const raw = safeStorage.getItem('mergeTowerOwnedSkins');
      if (raw) return JSON.parse(raw);
    } catch(e){}
    return ['default'];
  }
  let ownedSkins = loadOwnedSkins();
  let equippedSkin = safeStorage.getItem('mergeTowerEquippedSkin') || 'default';

  // --- Meta Tower Progression & Citadel Perks ---
  const TOWER_THRESHOLDS = [0, 40, 100, 200, 350, 550, 800, 1200];
  const TOWER_PERKS = [
    { level: 2, icon: '⚡', nameRu: 'Звёздная интуиция', nameEn: 'Star Intuition', descRu: '+15% очков за комбо-цепи', descEn: '+15% score on combo chains' },
    { level: 3, icon: '🧲', nameRu: 'Астральная тяга', nameEn: 'Astral Pull', descRu: 'Шары одного уровня притягиваются сильнее', descEn: 'Matching spheres attract faster' },
    { level: 4, icon: '🛡️', nameRu: 'Запас мудрости', nameEn: 'Wisdom Stash', descRu: 'Быстрое восстановление толчка', descEn: 'Faster tactical nudge cooldown' },
    { level: 5, icon: '✨', nameRu: 'Квантовый катализатор', nameEn: 'Quantum Catalyst', descRu: '+5% шанс на появление шара-джокера', descEn: '+5% chance to spawn a Wildcard sphere' },
    { level: 6, icon: '👑', nameRu: 'Око Цитадели', nameEn: 'Citadel Glory', descRu: 'Максимальный множитель комбо повышен до ×6', descEn: 'Max combo multiplier boosted to ×6' }
  ];

  function hasTowerPerk(lvlReq) {
    return towerLevelFor(towerXP()) >= lvlReq;
  }

  function towerXP() { return Number(safeStorage.getItem('mergeTowerTowerXP') || 0); }
  function towerLevelFor(xp) {
    let lv = 1;
    for (let i = 1; i < TOWER_THRESHOLDS.length; i++) {
      if (xp >= TOWER_THRESHOLDS[i]) lv = i + 1;
      else break;
    }
    return lv;
  }
  function addTowerXP(n) {
    const before = towerLevelFor(towerXP());
    const xp = towerXP() + n;
    safeStorage.setItem('mergeTowerTowerXP', String(xp));
    const after = towerLevelFor(xp);
    if (after > before) {
      addStars(6 + after);
      playStarChime(0);
      floatingTexts.push({ x: W / 2, y: dangerY + 60, text: '🏰 Уровень башни повышен!', life: 60, maxLife: 60, color: '#9a7bff', size: 16 });
    }
    queueCloudSave();
    renderTower();
  }
  function renderTower() {
    const xp = towerXP();
    const lv = towerLevelFor(xp);
    const cur = TOWER_THRESHOLDS[lv - 1] || 0;
    const next = TOWER_THRESHOLDS[lv] || (cur + 400);
    const pct = Math.min(100, Math.round(((xp - cur) / (next - cur)) * 100));
    const elIcon = document.getElementById('masterIcon');
    if (elIcon) elIcon.textContent = lv >= 6 ? '🌌' : (lv >= 4 ? '🏰' : (lv >= 2 ? '🏯' : '🏠'));
    const elLvl = document.getElementById('masterLevelText');
    if (elLvl) elLvl.textContent = `${t('towerMeta')} — ${t('levelLabel') || 'Уровень'} ${lv}`;
    const elFill = document.getElementById('masterXpFill');
    if (elFill) elFill.style.width = pct + '%';
    const elXp = document.getElementById('masterXpText');
    if (elXp) elXp.textContent = `${xp} / ${next} XP`;
    const elReward = document.getElementById('masterRewardText');
    if (elReward) {
      elReward.textContent = lv >= TOWER_THRESHOLDS.length
        ? (currentLang === 'ru' ? '★ Максимальное величие достигнуто!' : '★ Maximum glory reached!')
        : (currentLang === 'ru' ? `Следующий уровень: +${6 + lv + 1} ★` : `Next level: +${6 + lv + 1} ★`);
    }

    const perksContainer = document.getElementById('towerPerksList');
    if (perksContainer) {
      perksContainer.innerHTML = '';
      TOWER_PERKS.forEach(perk => {
        const isUnlocked = lv >= perk.level;
        const card = document.createElement('div');
        card.className = 'tower-perk-card' + (isUnlocked ? ' unlocked' : '');
        card.innerHTML = `
          <div style="font-size:20px; filter: drop-shadow(0 0 6px ${isUnlocked ? '#ffd23f' : 'transparent'});">${perk.icon}</div>
          <div style="flex:1; text-align:left;">
            <div style="font-size:12px; font-weight:800; color:${isUnlocked ? '#ffffff' : 'rgba(255,255,255,0.7)'};">${currentLang === 'ru' ? perk.nameRu : perk.nameEn}</div>
            <div style="font-size:10px; color:${isUnlocked ? '#cbd5e1' : 'var(--text-dim)'}; margin-top:1px;">${currentLang === 'ru' ? perk.descRu : perk.descEn}</div>
          </div>
          <div class="tower-perk-badge ${isUnlocked ? 'active' : 'locked'}">
            ${isUnlocked ? (currentLang === 'ru' ? '✔ Активен' : '✔ Active') : (currentLang === 'ru' ? `Ур. ${perk.level}` : `Lv. ${perk.level}`)}
          </div>
        `;
        perksContainer.appendChild(card);
      });
    }
  }

  function addStars(n) {
    starCoins += n;
    safeStorage.setItem('mergeTowerStars', String(starCoins));
    updateStarsUI();
    queueCloudSave();
  }
  function spendStars(n) {
    if (starCoins < n) return false;
    starCoins -= n;
    safeStorage.setItem('mergeTowerStars', String(starCoins));
    updateStarsUI();
    return true;
  }
  function updateShopUI() {
    const shopStars = document.getElementById('shopStarsVal') || document.getElementById('shopModalStarsVal');
    if (shopStars) shopStars.textContent = starCoins;
    const shopModal = document.getElementById('shopModal');
    if (shopModal && shopModal.classList.contains('show-modal')) {
      renderShopModal();
    }
    const upgradesModal = document.getElementById('upgradesModal');
    if (upgradesModal && upgradesModal.classList.contains('show-modal')) {
      renderUpgradesModal();
    }
  }
  function updateStarsUI() {
    const el = document.getElementById('starsVal');
    if (el) el.textContent = starCoins;
    const menuStars = document.getElementById('menuStarsVal');
    if (menuStars) menuStars.textContent = starCoins;
    const hommStars = document.getElementById('starsValMenu');
    if (hommStars) hommStars.textContent = starCoins;
    const upStars = document.getElementById('upgradesStarsVal');
    if (upStars) upStars.textContent = starCoins;
    const shopStars = document.getElementById('shopStarsVal') || document.getElementById('shopModalStarsVal');
    if (shopStars) shopStars.textContent = starCoins;
    updateToolButtons();
    updateShopUI();
  }

  // --- Upgrades & Tactical Perks ---
  const UPGRADES_DEF = [
    { id: 'combo', icon: '⚡', nameRu: 'Продление комбо', nameEn: 'Combo Flux', descRu: '+25% длительности комбо', descEn: '+25% combo window', max: 5, baseCost: 8, costStep: 4 },
    { id: 'magnet', icon: '🧲', nameRu: 'Грави-магнит', nameEn: 'Grav-Magnet', descRu: 'Стягивает одинаковые шары вместе', descEn: 'Attracts matching balls together', max: 5, baseCost: 10, costStep: 5 },
    { id: 'luck', icon: '🔮', nameRu: 'Удача Джокера', nameEn: 'Wildcard Luck', descRu: '+25% шанс появления Джокера ✦', descEn: '+25% Wildcard ball chance', max: 5, baseCost: 12, costStep: 6 },
    { id: 'nudge', icon: '📳', nameRu: 'Сила толчка', nameEn: 'Tower Nudge', descRu: 'Ускоряет перезарядку толчка на 20%', descEn: '-20% nudge cooldown & +force', max: 5, baseCost: 8, costStep: 4 },
  ];

  function loadUpgrades() {
    try {
      const raw = safeStorage.getItem('mergeTowerUpgrades');
      if (raw) return JSON.parse(raw);
    } catch(e){}
    return { combo: 0, magnet: 0, luck: 0, nudge: 0 };
  }
  let upgrades = loadUpgrades();
  function saveUpgrades() {
    safeStorage.setItem('mergeTowerUpgrades', JSON.stringify(upgrades));
    queueCloudSave();
  }
  function getUpgradeLevel(id) { return upgrades[id] || 0; }
  function getUpgradeCost(def) {
    const lvl = getUpgradeLevel(def.id);
    return def.baseCost + lvl * def.costStep;
  }

  // --- Tactical Nudge Mechanics ---
  let nudgeTimer = 0;
  function getNudgeMaxCooldown() {
    const rank = getUpgradeLevel('nudge');
    const towerDiscount = hasTowerPerk(4) ? 2.5 : 0;
    return Math.max(4, 14 - rank * 1.8 - towerDiscount);
  }

  function useNudge() {
    if (gameOver || !running) return;
    if (nudgeTimer > 0) return;
    const rank = getUpgradeLevel('nudge');
    const force = 2.4 + rank * 0.45;
    balls.forEach(b => {
      if (!b.isStatic) {
        b.velocity.y -= (force * (0.85 + Math.random() * 0.45));
        b.velocity.x += (Math.random() - 0.5) * (force * 1.1);
      }
    });

    // Singularity Legion House perk: Gravitational Vortex
    if (currentHouse === 'singularity') {
      for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
          const b1 = balls[i];
          const b2 = balls[j];
          if (!b1.isStatic && !b2.isStatic && b1.level === b2.level) {
            const dx = b2.position.x - b1.position.x;
            const dy = b2.position.y - b1.position.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 15 && dist < 140) {
              const pull = 2.2 / dist;
              b1.velocity.x += dx * pull;
              b1.velocity.y += dy * pull;
              b2.velocity.x -= dx * pull;
              b2.velocity.y -= dy * pull;
            }
          }
        }
      }
      spawnSingularity(W / 2, (TUBE_TOP + dangerY) * 0.55, '#c084fc', 48);
    }

    shakeAmount = 14;
    playThud();
    triggerHaptic([35, 25, 45]);
    floatingTexts.push({
      x: W / 2, y: dangerY + 40,
      text: currentHouse === 'singularity' 
        ? (currentLang === 'ru' ? '🕳️ СИНГУЛЯРНОСТЬ!' : '🕳️ SINGULARITY!')
        : (currentLang === 'ru' ? '📳 ТОЛЧОК!' : '📳 NUDGE!'),
      life: 50, maxLife: 50, color: currentHouse === 'singularity' ? '#c084fc' : '#4deeea', size: 18
    });
    nudgeTimer = getNudgeMaxCooldown();
    updateNudgeUI();
  }

  function updateNudgeUI() {
    const btn = document.getElementById('nudgeBtn');
    const cost = document.getElementById('nudgeCost');
    if (!btn || !cost) return;
    if (nudgeTimer > 0) {
      btn.classList.add('disabled');
      btn.style.opacity = '0.6';
      cost.textContent = Math.ceil(nudgeTimer) + 'с';
    } else {
      btn.classList.remove('disabled');
      btn.style.opacity = '1';
      cost.textContent = currentLang === 'ru' ? 'Готов' : 'Ready';
    }
  }

  // --- Suika-Compliant Balanced Ball Spawning ---
  // Drops only small balls (0, 1, 2, rare 3). Eliminates frustrating giant drops!
  function randSpawnLevel() {
    const r = (gameMode === 'daily' ? dailyRandom() : Math.random());
    if (highestLevel >= 4 && r < 0.08) return 3;
    if (r < 0.48) return 0;
    if (r < 0.82) return 1;
    return 2;
  }

  function decideNextSpawn() {
    const luckRank = getUpgradeLevel('luck');
    const houseBonus = currentHouse === 'nebula' ? 0.025 : 0;
    const towerBonus = hasTowerPerk(5) ? 0.05 : 0;
    const wildcardChance = 0.035 + luckRank * 0.012 + houseBonus + towerBonus;
    if (highestLevel >= 2 && (gameMode === 'daily' ? dailyRandom() : Math.random()) < wildcardChance) {
      return { wildcard: true, level: -1 };
    }
    return { wildcard: false, level: randSpawnLevel() };
  }
  let nextSpawn = decideNextSpawn();

  function updateNextPreview() {
    const el = document.getElementById('nextBallWrap');
    if (!nextSpawn || (!nextSpawn.wildcard && !LEVELS[nextSpawn.level])) nextSpawn = decideNextSpawn();
    if (nextSpawn.wildcard) {
      el.style.background = 'conic-gradient(from 0deg, #4deeea, #9a7bff, #ff3d9a, #ffd23f, #4deeea)';
      el.style.boxShadow = '0 0 16px rgba(255,210,63,0.7)';
      el.textContent = '✦';
      el.style.color = '#fff';
      return;
    }
    const lv = LEVELS[nextSpawn.level];
    el.style.background = `radial-gradient(circle at 35% 30%, #ffffff, ${lv.color})`;
    el.style.boxShadow = `0 0 14px ${lv.glow}`;
    el.textContent = lv.label;
    el.style.color = '#04122a';
  }

  function spawnCurrent() {
    if (!nextSpawn || (!nextSpawn.wildcard && !LEVELS[nextSpawn.level])) nextSpawn = decideNextSpawn();
    const spawn = nextSpawn;
    const r = spawn.wildcard ? LEVELS[0].r : LEVELS[spawn.level].r;
    const x = clamp(aimX, r + TUBE_MARGIN, W - r - TUBE_MARGIN);
    const body = makeBall(x, TUBE_TOP + 24, r, spawn.level);
    if (spawn.wildcard) body.label = 'wildcard';
    body.isStatic = true;
    body.isFalling = true;
    body.spawnAt = performance.now();
    balls.push(body);
    currentBall = body;
    canDrop = true;
    nextSpawn = decideNextSpawn();
    updateNextPreview();
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function clampAim(x) {
    const r = currentBall ? currentBall.circleRadius : 16;
    return clamp(x, r + TUBE_MARGIN, W - r - TUBE_MARGIN);
  }

  let spawnTimeoutId = null;
  function dropCurrent() {
    if (!currentBall || !canDrop || gameOver) return;
    canDrop = false;
    dropMergeChain = 0;
    const droppedBall = currentBall;
    droppedBall.isFalling = false;
    droppedBall.isStatic = false;
    currentBall = null;
    triggerCharThrow();
    triggerHaptic([15]);
    if (tutorialActive) endTutorial();

    clearTimeout(spawnTimeoutId);
    spawnTimeoutId = setTimeout(() => {
      spawnTimeoutId = null;
      if (!gameOver && !goalAchieved) {
        if (!running) running = true;
        spawnCurrent();
      }
    }, 260);
  }

  function triggerHaptic(pattern) {
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(pattern);
      }
    } catch(e){}
  }

  // --- Multi-Pass Physics Engine ---
  const mergingSet = new Set();
  let slowMoFrames = 0;

  function physicsStep() {
    const slowMoScale = slowMoFrames > 0 ? 0.45 : 1.0;
    if (slowMoFrames > 0) slowMoFrames--;
    const dtSub = (1 / SUBSTEPS) * slowMoScale;
    for (let sub = 0; sub < SUBSTEPS; sub++) {
      // 1. Motion integration
      for (const b of balls) {
        if (b.isStatic) continue;
        b.velocity.y += (GRAVITY * locGravityMult) * dtSub;
        b.velocity.x *= Math.pow(AIR_DAMPING, dtSub);
        b.velocity.y *= Math.pow(AIR_DAMPING, dtSub);
        b.position.x += b.velocity.x * dtSub;
        b.position.y += b.velocity.y * dtSub;
        b.angle += (b.velocity.x * 0.02) * dtSub;

        // Tube boundary collisions
        const r = b.circleRadius;
        if (b.position.x - r < 0) {
          b.position.x = r;
          b.velocity.x = Math.abs(b.velocity.x) * WALL_RESTITUTION * locRestitutionMult;
        }
        if (b.position.x + r > W) {
          b.position.x = W - r;
          b.velocity.x = -Math.abs(b.velocity.x) * WALL_RESTITUTION * locRestitutionMult;
        }
        if (b.position.y + r > H) {
          const impactSpeed = b.velocity.y;
          b.position.y = H - r;
          b.velocity.y = -Math.abs(b.velocity.y) * WALL_RESTITUTION * locRestitutionMult;
          if (Math.abs(b.velocity.y) < 0.6) b.velocity.y = 0;
          b.velocity.x *= locFloorFriction;
          if (b.gameLevel >= 5 && impactSpeed > 4.5) {
            shakeAmount = Math.max(shakeAmount, 2.5);
            playThud();
          }
        }
        if (b.position.y - r < TUBE_TOP) {
          b.position.y = TUBE_TOP + r;
          b.velocity.y = Math.abs(b.velocity.y) * 0.2;
        }
      }

      // 2. Pairwise Collision & Merge Clustering
      const parent = new Map();
      function find(id) {
        if (!parent.has(id)) parent.set(id, id);
        let root = id;
        let limit = 40;
        while (parent.has(root) && parent.get(root) !== root && limit-- > 0) {
          root = parent.get(root);
        }
        let cur = id;
        limit = 40;
        while (parent.has(cur) && parent.get(cur) !== root && limit-- > 0) {
          const n = parent.get(cur);
          parent.set(cur, root);
          cur = n;
        }
        return root;
      }
      function union(a, b) {
        const ra = find(a), rb = find(b);
        if (ra !== rb && ra !== undefined && rb !== undefined) parent.set(ra, rb);
      }
      for (const b of balls) parent.set(b.id, b.id);

      let supernovaNeeded = false;

      for (let i = 0; i < balls.length; i++) {
        const a = balls[i];
        for (let j = i + 1; j < balls.length; j++) {
          const b = balls[j];
          // Spheres being aimed/held at the top must not participate in collisions or merges
          if (a.isStatic || b.isStatic || a.isFalling || b.isFalling) continue;

          const dx = b.position.x - a.position.x;
          const dy = b.position.y - a.position.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
          const minDist = a.circleRadius + b.circleRadius;

          if (dist < minDist) {
            const aBall = a.label.startsWith('ball_'), bBall = b.label.startsWith('ball_');
            const aWild = a.label === 'wildcard', bWild = b.label === 'wildcard';
            const maxLvl = LEVELS.length - 1;

            if (aBall && bBall && a.gameLevel === maxLvl && b.gameLevel === maxLvl && !mergingSet.has(a.id) && !mergingSet.has(b.id)) {
              mergingSet.add(a.id); mergingSet.add(b.id);
              supernovaNeeded = true;
              continue;
            }

            if ((aBall && bBall && a.gameLevel === b.gameLevel && a.gameLevel < maxLvl) ||
                (aWild && bBall && b.gameLevel < maxLvl) ||
                (bWild && aBall && a.gameLevel < maxLvl)) {
              union(a.id, b.id);
              continue;
            }

            // Standard collision impulse & overlap push
            const overlap = minDist - dist;
            const nx = dx / dist, ny = dy / dist;
            const invA = a.isStatic ? 0 : 1 / a.mass;
            const invB = b.isStatic ? 0 : 1 / b.mass;
            const totalInv = invA + invB;
            if (totalInv > 0) {
              if (!a.isStatic) { a.position.x -= nx * (overlap * (invA / totalInv)); a.position.y -= ny * (overlap * (invA / totalInv)); }
              if (!b.isStatic) { b.position.x += nx * (overlap * (invB / totalInv)); b.position.y += ny * (overlap * (invB / totalInv)); }

              const relVx = b.velocity.x - a.velocity.x;
              const relVy = b.velocity.y - a.velocity.y;
              const relNorm = relVx * nx + relVy * ny;
              if (relNorm < 0) {
                const impulse = -(1 + BALL_RESTITUTION * locRestitutionMult) * relNorm / totalInv;
                if (!a.isStatic) { a.velocity.x -= impulse * invA * nx; a.velocity.y -= impulse * invA * ny; }
                if (!b.isStatic) { b.velocity.x += impulse * invB * nx; b.velocity.y += impulse * invB * ny; }
              }
            }
          } else {
            // Grav-Magnet perk + Citadel Perk 3: subtle magnetic attraction between nearby matching spheres
            const magnetRank = getUpgradeLevel('magnet') + (hasTowerPerk(3) ? 1.5 : 0);
            if (magnetRank > 0) {
              const aBall = a.label.startsWith('ball_'), bBall = b.label.startsWith('ball_');
              const aWild = a.label === 'wildcard', bWild = b.label === 'wildcard';
              if ((aBall && bBall && a.gameLevel === b.gameLevel) || aWild || bWild) {
                const pullRadius = minDist * (1.18 + magnetRank * 0.14);
                if (dist < pullRadius) {
                  const pullForce = 0.24 * magnetRank * ((pullRadius - dist) / pullRadius);
                  const nx = dx / dist, ny = dy / dist;
                  if (!a.isStatic) { a.velocity.x += nx * pullForce; a.velocity.y += ny * pullForce; }
                  if (!b.isStatic) { b.velocity.x -= nx * pullForce; b.velocity.y -= ny * pullForce; }
                }
              }
            }
          }
        }
      }

      if (supernovaNeeded) {
        triggerSupernova();
        return;
      }

      // Merge grouped clusters on the final substep
      if (sub === SUBSTEPS - 1) {
        const groups = new Map();
        for (const b of balls) {
          if (b.isStatic || b.isFalling || b === currentBall) continue;
          if (!b.label.startsWith('ball_') && b.label !== 'wildcard') continue;
          if (!parent.has(b.id)) continue;
          const root = find(b.id);
          if (!groups.has(root)) groups.set(root, []);
          groups.get(root).push(b);
        }
        for (const members of groups.values()) {
          if (members.length >= 2) {
            const normal = members.find(m => m.label !== 'wildcard');
            if (normal) scheduleMerge(members, normal.gameLevel);
          }
        }
      }
    }
  }

  function scheduleMerge(members, lvl) {
    let mx = 0, my = 0;
    const usedWild = members.some(m => m.label === 'wildcard');
    members.forEach(m => { mx += m.position.x; my += m.position.y; });
    mx /= members.length; my /= members.length;
    members.forEach(m => {
      balls = balls.filter(x => x.id !== m.id);
      mergingSet.delete(m.id);
      if (currentBall && currentBall.id === m.id) currentBall = null;
    });

    mergesCount++;
    const now = performance.now();
    if (now - lastDropMergeTime > 2400) {
      dropMergeChain = 0;
    }
    dropMergeChain++;
    lastDropMergeTime = now;

    const nextLvl = lvl + 1;
    achState.totalMerges = (achState.totalMerges || 0) + 1;
    if (nextLvl > (achState.maxLevelEver || 0)) achState.maxLevelEver = nextLvl;

    const nl = LEVELS[nextLvl];
    const nb = makeBall(mx, my, nl.r, nextLvl);
    nb.isFalling = false;
    nb.spawnAt = performance.now();
    balls.push(nb);

    if (comboTimer > 0) comboCount++;
    else comboCount = 1;
    const chronoComboMult = currentHouse === 'chrono' ? 1.35 : 1.0;
    comboTimer = Math.round(COMBO_WINDOW * (1 + getUpgradeLevel('combo') * 0.25) * chronoComboMult);

    // Cosmic Fever Mode Charge & Multiplier
    if (!feverActive) {
      const pulsarChargeMult = currentHouse === 'pulsar' ? 1.3 : 1.0;
      const baseCharge = (members.length > 2 ? 24 : (nextLvl >= 5 ? 18 : 12)) * pulsarChargeMult;
      feverCharge = Math.min(100, feverCharge + baseCharge);
      updateFeverUI();
      if (feverCharge >= 100) {
        activateFeverMode();
      }
    } else {
      feverDuration = Math.min(FEVER_MAX_DURATION, feverDuration + 0.4);
      try { AudioManager.playFeverMerge(nextLvl, dropMergeChain); } catch(e) {}
    }

    const feverMult = feverActive ? 3 : 1;
    const maxMultiplier = hasTowerPerk(6) ? 6 : 5;
    const multiplier = Math.min(comboCount, maxMultiplier);
    const groupBonus = members.length > 2 ? 1.5 : 1;
    const singBonus = (currentHouse === 'singularity' && nextLvl >= 4) ? 1.15 : 1.0;
    const pulsarBonus = currentHouse === 'pulsar' ? 1.10 : 1.0;
    const towerComboBonus = (dropMergeChain > 1 && hasTowerPerk(2)) ? 1.15 : 1.0;
    const gained = Math.round((nextLvl + 1) * 5 * multiplier * groupBonus * feverMult * singBonus * pulsarBonus * towerComboBonus);
    score += gained;
    updateScore();

    // Nebula Covenant perk: Quantum Stardust Bounty every 10 merges
    if (currentHouse === 'nebula' && mergesCount > 0 && mergesCount % 10 === 0) {
      addStars(1);
      floatingTexts.push({
        x: mx, y: my - nl.r - 48,
        text: currentLang === 'ru' ? '+1 ★ Небула' : '+1 ★ Nebula',
        life: 60, maxLife: 60,
        color: '#34d399', size: 15
      });
      spawnMergeParticles(mx, my, '#34d399');
    }

    if (nextLvl > highestLevel) {
      highestLevel = nextLvl;
      addStars(2);
      triggerCharCheer();
    }
    if (multiplier >= 2 || members.length > 2 || feverActive) {
      triggerCharCheer();
    }
    if (multiplier >= 4 || feverActive) {
      triggerCharDance();
    }

    // Singularity Legion & Cosmic Collapse effect
    if (nextLvl >= 7 || multiplier >= 3 || members.length > 2) {
      spawnSingularity(mx, my, nl.color, Math.max(34, nl.r * 1.05));
    }

    // Dynamic radial shock impulse for heavyweight spheres (pushes nearby spheres)
    if (nextLvl >= 5) {
      AudioManager.playSubBassPunch(nextLvl);
      const shockR = nl.r * 2.3;
      balls.forEach(b => {
        if (b !== nb && !b.isFalling && !b.isStatic) {
          const dx = b.position.x - mx;
          const dy = b.position.y - my;
          const dist = Math.hypot(dx, dy);
          if (dist > 0 && dist < shockR) {
            const push = (1 - dist / shockR) * (2.2 + nextLvl * 0.35);
            b.velocity.x += (dx / dist) * push;
            b.velocity.y += (dy / dist) * push * 0.6;
          }
        }
      });
    }

    // Micro hit-stop replaced with haptic impulse and screen micro-shake
    if (nextLvl >= 7) {
      triggerHaptic([35]);
    }
    if (dropMergeChain >= 3 || nextLvl >= 7) {
      slowMoFrames = 5;
    }

    spawnMergeParticles(mx, my, nl.color);
    spawnMergeShockwave(mx, my, nl.color, Math.max(24, nl.r * 0.7));
    playPop(nextLvl, multiplier, dropMergeChain);
    triggerHaptic(dropMergeChain > 2 ? [25, 20, 35] : (multiplier > 2 || feverActive ? [30, 20, 40] : [25]));

    shakeAmount = Math.min(26, 4 + nextLvl * 1.6) * (members.length > 2 || feverActive ? 1.35 : 1);
    floatingTexts.push({
      x: mx, y: my - nl.r - 8,
      text: (feverActive ? '🔥 +' : '+') + gained + (feverActive ? ' (×3!)' : ''),
      life: feverActive ? 52 : 44,
      maxLife: feverActive ? 52 : 44,
      color: feverActive ? '#ffd23f' : (multiplier > 1 ? '#ffd23f' : '#ffffff'),
      size: feverActive ? 22 : (multiplier > 1 ? 20 : 15)
    });

    if (members.length > 2) {
      floatingTexts.push({
        x: mx, y: my - nl.r - 36, text: t('tripleMerge') || '×3 Слияние!', life: 50, maxLife: 50,
        color: '#ff9f43', size: 14
      });
    }
    if (multiplier > 1) {
      floatingTexts.push({
        x: mx, y: my - nl.r - 24, text: (currentLang === 'ru' ? 'Комбо ×' : 'Combo ×') + multiplier,
        life: 50, maxLife: 50, color: '#ff3d9a', size: 14
      });
    }
    if (dropMergeChain > 1) {
      const chainTitle = dropMergeChain >= 4
        ? (currentLang === 'ru' ? `🌌 ×${dropMergeChain} СИНГУЛЯРНОСТЬ!` : `🌌 ×${dropMergeChain} SINGULARITY!`)
        : (dropMergeChain === 3
          ? (currentLang === 'ru' ? '💥 ×3 СУПЕРНОВА!' : '💥 ×3 SUPERNOVA!')
          : (currentLang === 'ru' ? '⚡ ×2 ЦЕПЬ!' : '⚡ ×2 CHAIN!'));
      floatingTexts.push({
        x: mx, y: my - nl.r - (multiplier > 1 ? 42 : 28),
        text: chainTitle,
        life: 56, maxLife: 56,
        color: dropMergeChain >= 4 ? '#ffd23f' : (dropMergeChain >= 3 ? '#ff3d9a' : '#4deeea'),
        size: dropMergeChain >= 3 ? 18 : 15
      });
    }

    updateGoalBanner();
    checkGoalCompletion();
    saveAchState();
    checkAchievements();
    addTowerXP(nextLvl);
    updateMissionsProgress(1, score, nextLvl);
  }

  function triggerSupernova() {
    const cleared = balls.filter(b => b !== currentBall && b.label.startsWith('ball_'));
    if (cleared.length === 0) return;
    const cx = W / 2, cy = H * 0.5;
    let bonus = 0;
    cleared.forEach(b => {
      bonus += (b.gameLevel + 1) * 8;
      spawnMergeParticles(b.position.x, b.position.y, LEVELS[b.gameLevel].color);
      balls = balls.filter(x => x.id !== b.id);
    });
    mergingSet.clear();
    score += bonus;
    updateScore();
    addStars(10);
    shakeAmount = 24;
    triggerHaptic([60, 40, 80]);
    spawnMergeParticles(cx, cy, '#ffd23f');
    spawnMergeParticles(cx, cy, '#ffffff');
    playPop(9, 3);

    floatingTexts.push({ x: cx, y: cy, text: '✦ СУПЕРНОВАЯ! ✦', life: 75, maxLife: 75, color: '#ffd23f', size: 22 });
    floatingTexts.push({ x: cx, y: cy + 30, text: `+${bonus} · +10★`, life: 65, maxLife: 65, color: '#fff', size: 14 });
    updateGoalBanner();
    checkGoalCompletion();
    saveAchState();
    checkAchievements();
  }

  // ==========================================
  // 1. COSMIC FEVER MODE (ЛИХОРАДКА)
  // ==========================================
  let feverCharge = 0; // 0 to 100
  let feverActive = false;
  let feverDuration = 0;
  const FEVER_MAX_DURATION = 8.0;

  function updateFeverUI() {
    const banner = document.getElementById('feverBanner');
    const fill = document.getElementById('feverBarFill');
    const label = document.getElementById('feverLabel');
    const multBadge = document.getElementById('feverMultBadge');
    const stageInnerEl = document.getElementById('stage-inner');

    if (!banner || !fill) return;

    if (!running || gameOver || document.body.classList.contains('in-menu')) {
      banner.style.display = 'none';
      if (stageInnerEl) stageInnerEl.classList.remove('fever-active-glow');
      return;
    }

    banner.style.display = 'flex';

    if (feverActive) {
      const pct = Math.max(0, Math.min(100, (feverDuration / FEVER_MAX_DURATION) * 100));
      fill.style.width = pct + '%';
      fill.style.background = 'linear-gradient(90deg, #ffd23f 0%, #ff3d9a 50%, #4deeea 100%)';
      if (label) label.textContent = (currentLang === 'ru' ? '🔥 ЛИХОРАДКА ' : '🔥 FEVER ') + Math.ceil(feverDuration) + 'с';
      if (multBadge) {
        multBadge.textContent = '×3';
        multBadge.style.color = '#ffd23f';
      }
      if (stageInnerEl) stageInnerEl.classList.add('fever-active-glow');
    } else {
      fill.style.width = feverCharge + '%';
      fill.style.background = 'linear-gradient(90deg, #38bdf8 0%, #ffd23f 70%, #ff3d9a 100%)';
      if (label) label.textContent = t('feverLabel') + ' ' + Math.floor(feverCharge) + '%';
      if (multBadge) {
        multBadge.textContent = feverCharge >= 75 ? '⚡ READY' : '×1';
        multBadge.style.color = feverCharge >= 75 ? '#ff3d9a' : '#8fd3f4';
      }
      if (stageInnerEl) stageInnerEl.classList.remove('fever-active-glow');
    }
  }

  function activateFeverMode() {
    if (feverActive) return;
    feverActive = true;
    feverDuration = FEVER_MAX_DURATION;
    feverCharge = 100;
    triggerHaptic([40, 30, 60]);
    shakeAmount = 14;
    try { AudioManager.playFeverStart(); } catch(e) {}
    triggerCharDance();
    updateFeverUI();

    floatingTexts.push({
      x: W / 2,
      y: TUBE_TOP + 50,
      text: t('feverActiveMsg'),
      life: 75,
      maxLife: 75,
      color: '#ffd23f',
      size: 20
    });

    for (let i = 0; i < 28; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 2 + Math.random() * 5;
      particles.push({
        x: W / 2 + (Math.random() - 0.5) * 120,
        y: TUBE_TOP + 40 + (Math.random() - 0.5) * 40,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 45,
        maxLife: 45,
        color: Math.random() > 0.5 ? '#ffd23f' : '#ff3d9a'
      });
    }
  }

  function deactivateFeverMode() {
    feverActive = false;
    feverDuration = 0;
    feverCharge = 0;
    updateFeverUI();
  }

  // ==========================================
  // 2. EMERGENCY RESCUE (СПАСЕНИЕ БАШНИ)
  // ==========================================
  let canRescueThisRun = true;
  let rescueCountdownTimer = null;
  let rescueSecondsLeft = 5;
  let rescueGraceTimer = 0;

  function startEmergencyRescue() {
    canRescueThisRun = false;
    running = false;
    rescueSecondsLeft = 5;
    openModal('rescueModal');
    try { AudioManager.playDangerAlarm?.(); } catch(e) {}

    const countEl = document.getElementById('rescueTimerText');
    const circleEl = document.getElementById('rescueTimerCircle');
    const circumference = 213.6;

    if (countEl) countEl.textContent = rescueSecondsLeft;
    if (circleEl) circleEl.style.strokeDashoffset = '0';

    if (rescueCountdownTimer) clearInterval(rescueCountdownTimer);
    const startTime = Date.now();
    const durationMs = 5000;

    rescueCountdownTimer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remainingMs = Math.max(0, durationMs - elapsed);
      rescueSecondsLeft = Math.ceil(remainingMs / 1000);

      if (countEl) countEl.textContent = rescueSecondsLeft;
      if (circleEl) {
        const progress = elapsed / durationMs;
        circleEl.style.strokeDashoffset = (progress * circumference).toFixed(1);
      }

      if (remainingMs <= 0) {
        clearInterval(rescueCountdownTimer);
        rescueCountdownTimer = null;
        closeModal('rescueModal');
        showGameOver();
      }
    }, 100);
  }

  function performRescueVortex() {
    if (rescueCountdownTimer) {
      clearInterval(rescueCountdownTimer);
      rescueCountdownTimer = null;
    }
    closeModal('rescueModal');
    try { AudioManager.playRescueVortex(); } catch(e) {}
    triggerHaptic([50, 40, 80]);

    // Vaporize the 4 highest settled balls
    const settledBalls = balls.filter(b => b !== currentBall)
      .sort((a, b) => a.position.y - b.position.y);
    const toRemove = settledBalls.slice(0, 4);

    toRemove.forEach(tb => {
      spawnSingularity(tb.position.x, tb.position.y, '#c084fc', tb.circleRadius * 1.5);
      spawnMergeShockwave(tb.position.x, tb.position.y, '#ff3d9a', tb.circleRadius * 1.8);
      for (let i = 0; i < 16; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 2 + Math.random() * 4;
        particles.push({
          x: tb.position.x,
          y: tb.position.y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          life: 35,
          maxLife: 35,
          color: '#ff3d9a'
        });
      }
    });

    const removeIds = new Set(toRemove.map(b => b.id));
    balls = balls.filter(b => !removeIds.has(b.id));

    dangerTimer = 0;
    dangerProximity = 0;
    rescueGraceTimer = 3.5;
    gameOver = false;
    running = true;

    floatingTexts.push({
      x: W / 2,
      y: dangerY + 40,
      text: t('rescueSavedMsg'),
      life: 80,
      maxLife: 80,
      color: '#4deeea',
      size: 18
    });

    triggerCharCheer();
    CHAR.flipT = 1;
  }

  function triggerRescueWithAd() {
    if (!ysdk?.adv?.showRewardedVideo) {
      performRescueVortex();
      return;
    }
    let rewarded = false;
    try {
      ysdk.adv.showRewardedVideo({
        callbacks: {
          onOpen: () => {
            if (rescueCountdownTimer) clearInterval(rescueCountdownTimer);
            try { actx && actx.suspend(); } catch(e){}
          },
          onRewarded: () => {
            rewarded = true;
            performRescueVortex();
          },
          onClose: () => {
            try { actx && actx.resume(); } catch(e){}
            if (!rewarded) {
              closeModal('rescueModal');
              showGameOver();
            }
          },
          onError: () => {
            try { actx && actx.resume(); } catch(e){}
            performRescueVortex();
          }
        }
      });
    } catch(e) {
      performRescueVortex();
    }
  }

  // ==========================================
  // 3. CELESTIAL WHEEL OF FORTUNE (АЛТАРЬ)
  // ==========================================
  const FORTUNE_SECTORS = [
    { type: 'stars', amount: 15, label: '+15 ★', color: '#1a2754', icon: '★', textColor: '#ffd23f' },
    { type: 'item', item: 'magnet', amount: 1, label: '🧲 x1', color: '#0d3d59', icon: '🧲', textColor: '#38bdf8' },
    { type: 'stars', amount: 30, label: '+30 ★', color: '#2a1a4e', icon: '★', textColor: '#ffd23f' },
    { type: 'item', item: 'supernova', amount: 1, label: '🌟 x1', color: '#4a154b', icon: '🌟', textColor: '#f472b6' },
    { type: 'stars', amount: 50, label: '+50 ★', color: '#163c4e', icon: '★', textColor: '#ffd23f' },
    { type: 'item', item: 'wildcard', amount: 1, label: '🃏 x1', color: '#3b1c54', icon: '🃏', textColor: '#c084fc' },
    { type: 'stars', amount: 100, label: '100 ★', color: '#4a380c', icon: '👑', textColor: '#ffd23f', jackpot: true },
    { type: 'stars', amount: 25, label: '+25 ★', color: '#132840', icon: '★', textColor: '#ffd23f' }
  ];

  let fortuneWheelAngle = 0;
  let isFortuneSpinning = false;

  function canClaimFreeFortuneToday() {
    const today = new Date().toISOString().slice(0, 10);
    const lastDate = safeStorage.getItem('mergeTowerLastFortuneDate');
    return lastDate !== today;
  }

  function updateFortuneUI() {
    const dot = document.getElementById('fortuneBadgeDot');
    const freeAvailable = canClaimFreeFortuneToday();
    if (dot) dot.style.display = freeAvailable ? 'block' : 'none';

    const spinBtn = document.getElementById('fortuneSpinBtn');
    const spinIcon = document.getElementById('fortuneSpinIcon');
    const spinText = document.getElementById('fortuneSpinText');

    if (spinBtn && spinText && !isFortuneSpinning) {
      if (freeAvailable) {
        if (spinIcon) spinIcon.textContent = '🎁';
        spinText.textContent = t('fortuneSpinFree');
        spinBtn.className = 'pill-3d-btn alt-gold primary-hero-btn';
      } else {
        if (spinIcon) spinIcon.textContent = '🎬';
        spinText.textContent = t('fortuneSpinAd');
        spinBtn.className = 'pill-3d-btn alt-magenta primary-hero-btn';
      }
    }
  }

  function drawFortuneWheel() {
    const cvs = document.getElementById('fortuneWheelCanvas');
    if (!cvs) return;
    const fctx = cvs.getContext('2d');
    const cx = cvs.width / 2;
    const cy = cvs.height / 2;
    const r = cx - 6;
    const numSectors = FORTUNE_SECTORS.length;
    const arc = (Math.PI * 2) / numSectors;

    fctx.clearRect(0, 0, cvs.width, cvs.height);

    fctx.save();
    fctx.translate(cx, cy);
    fctx.rotate(fortuneWheelAngle);

    // Outer rim fill
    fctx.beginPath();
    fctx.arc(0, 0, r, 0, Math.PI * 2);
    fctx.fillStyle = '#0a0e27';
    fctx.fill();

    // Draw Sectors
    for (let i = 0; i < numSectors; i++) {
      const sec = FORTUNE_SECTORS[i];
      const startAng = i * arc;
      const endAng = startAng + arc;

      fctx.beginPath();
      fctx.moveTo(0, 0);
      fctx.arc(0, 0, r - 3, startAng, endAng);
      fctx.closePath();
      fctx.fillStyle = sec.color;
      fctx.fill();

      fctx.lineWidth = 1.2;
      fctx.strokeStyle = sec.jackpot ? '#ffd23f' : 'rgba(255, 210, 63, 0.4)';
      fctx.stroke();

      // Sector Label & Icon
      fctx.save();
      fctx.rotate(startAng + arc / 2);
      fctx.textAlign = 'right';
      fctx.fillStyle = sec.textColor;
      fctx.font = sec.jackpot ? '900 13px sans-serif' : '800 12px sans-serif';
      fctx.shadowColor = sec.textColor;
      fctx.shadowBlur = sec.jackpot ? 10 : 4;
      fctx.fillText(sec.label, r - 22, 4);
      fctx.shadowBlur = 0;

      // Peg at edge
      fctx.beginPath();
      fctx.arc(r - 8, 0, 3, 0, Math.PI * 2);
      fctx.fillStyle = sec.jackpot ? '#ffd23f' : '#ffffff';
      fctx.fill();
      fctx.restore();
    }

    // Golden Center Hub
    fctx.beginPath();
    fctx.arc(0, 0, 22, 0, Math.PI * 2);
    const hubGrad = fctx.createRadialGradient(0, 0, 4, 0, 0, 22);
    hubGrad.addColorStop(0, '#ffe885');
    hubGrad.addColorStop(0.7, '#d4af37');
    hubGrad.addColorStop(1, '#664d00');
    fctx.fillStyle = hubGrad;
    fctx.shadowColor = '#ffd23f';
    fctx.shadowBlur = 12;
    fctx.fill();
    fctx.shadowBlur = 0;

    fctx.beginPath();
    fctx.arc(0, 0, 8, 0, Math.PI * 2);
    fctx.fillStyle = '#0a0e27';
    fctx.fill();

    fctx.restore();
  }

  function spinFortuneWheel() {
    if (isFortuneSpinning) return;
    isFortuneSpinning = true;

    const spinBtn = document.getElementById('fortuneSpinBtn');
    const spinText = document.getElementById('fortuneSpinText');
    const resNotice = document.getElementById('fortuneResultNotice');
    if (resNotice) resNotice.style.display = 'none';
    if (spinBtn) spinBtn.disabled = true;
    if (spinText) spinText.textContent = t('fortuneSpinning');

    const winIdx = Math.floor(Math.random() * FORTUNE_SECTORS.length);
    const numSectors = FORTUNE_SECTORS.length;
    const arc = (Math.PI * 2) / numSectors;

    const fullSpins = 4 + Math.floor(Math.random() * 3);
    const baseTarget = -Math.PI / 2 - (winIdx + 0.5) * arc;
    const curNorm = fortuneWheelAngle % (Math.PI * 2);
    let delta = baseTarget - curNorm;
    while (delta < 0) delta += Math.PI * 2;
    const totalRotation = fullSpins * Math.PI * 2 + delta;

    const startAngle = fortuneWheelAngle;
    const duration = 4000;
    const startTime = performance.now();
    let lastTickAngle = startAngle;

    function animateWheel(now) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const ease = 1 - Math.pow(1 - progress, 3);
      fortuneWheelAngle = startAngle + totalRotation * ease;

      if (Math.abs(fortuneWheelAngle - lastTickAngle) >= arc) {
        lastTickAngle = fortuneWheelAngle;
        try { AudioManager.playWheelTick(); } catch(e) {}
        triggerHaptic(15);
      }

      drawFortuneWheel();

      if (progress < 1) {
        requestAnimationFrame(animateWheel);
      } else {
        isFortuneSpinning = false;
        if (spinBtn) spinBtn.disabled = false;

        if (canClaimFreeFortuneToday()) {
          safeStorage.setItem('mergeTowerLastFortuneDate', new Date().toISOString().slice(0, 10));
        }
        const spinsCount = Number(safeStorage.getItem('mergeTowerFortuneSpinsCount') || 0) + 1;
        safeStorage.setItem('mergeTowerFortuneSpinsCount', String(spinsCount));
        queueCloudSave(true);
        updateFortuneUI();

        const prize = FORTUNE_SECTORS[winIdx];
        try { AudioManager.playWheelWin(); } catch(e) {}
        triggerHaptic([40, 30, 60]);

        if (prize.type === 'stars') {
          addStars(prize.amount);
        } else if (prize.type === 'item') {
          inventory[prize.item] = (inventory[prize.item] || 0) + prize.amount;
          saveInventory();
          updateStarsUI();
        }

        if (resNotice) {
          resNotice.style.display = 'block';
          const txt = document.getElementById('fortuneResultText');
          const icon = document.getElementById('fortuneResultIcon');
          if (icon) icon.textContent = prize.icon;
          if (txt) {
            txt.textContent = (prize.jackpot ? '👑 ' + t('fortuneJackpot') + ' ' : '') + t('fortuneReward') + ' ' + prize.label;
          }
        }
      }
    }
    requestAnimationFrame(animateWheel);
  }

  function triggerFortuneSpin() {
    if (isFortuneSpinning) return;
    if (canClaimFreeFortuneToday()) {
      spinFortuneWheel();
    } else {
      if (!ysdk?.adv?.showRewardedVideo) {
        spinFortuneWheel();
        return;
      }
      let rewarded = false;
      try {
        ysdk.adv.showRewardedVideo({
          callbacks: {
            onOpen: () => { try { actx && actx.suspend(); } catch(e){} },
            onRewarded: () => {
              rewarded = true;
              spinFortuneWheel();
            },
            onClose: () => {
              try { actx && actx.resume(); } catch(e){}
            },
            onError: () => {
              try { actx && actx.resume(); } catch(e){}
              spinFortuneWheel();
            }
          }
        });
      } catch(e) {
        spinFortuneWheel();
      }
    }
  }

  function updateScore() {
    document.getElementById('scoreVal').textContent = score;
    if (score > best) {
      best = score;
      document.getElementById('bestVal').textContent = best;
      safeStorage.setItem('mergeTowerBest', String(best));
      queueCloudSave();
      achState.bestScore = best;
      saveAchState();
      checkAchievements();
      if (!newRecordThisRun) {
        newRecordThisRun = true;
        floatingTexts.push({ x: W / 2, y: dangerY + 45, text: '★ Новый рекорд! ★', life: 60, maxLife: 60, color: '#ffd23f', size: 16 });
      }
    }
  }

  function updateHouseActiveBadge() {
    const badge = document.getElementById('houseActiveBadge');
    const icon = document.getElementById('houseActiveIcon');
    const name = document.getElementById('houseActiveName');
    if (!badge || !icon || !name) return;
    if (gameOver || document.body.classList.contains('in-menu')) {
      badge.style.display = 'none';
      return;
    }
    badge.style.display = 'inline-flex';
    if (currentHouse === 'chrono') {
      icon.textContent = '⚜️';
      name.textContent = currentLang === 'ru' ? 'ХРОНО: Замедление опасности & комбо' : 'CHRONO: Time Dilation & Combo';
      badge.style.borderColor = 'rgba(77, 238, 234, 0.5)';
      badge.style.color = '#4deeea';
    } else if (currentHouse === 'singularity') {
      icon.textContent = '🕳️';
      name.textContent = currentLang === 'ru' ? 'СИНГУЛЯРНОСТЬ: Гравитация & Мега-очки' : 'SINGULARITY: Gravity & Mega-Bonus';
      badge.style.borderColor = 'rgba(192, 132, 252, 0.5)';
      badge.style.color = '#c084fc';
    } else if (currentHouse === 'pulsar') {
      icon.textContent = '⚡';
      name.textContent = currentLang === 'ru' ? 'ПУЛЬСАР: Лихорадка +30% & Очки +10%' : 'PULSAR: Rapid Fever & Merge Bonus';
      badge.style.borderColor = 'rgba(245, 158, 11, 0.5)';
      badge.style.color = '#f59e0b';
    } else if (currentHouse === 'nebula') {
      icon.textContent = '🪸';
      name.textContent = currentLang === 'ru' ? 'НЕБУЛА: Джокеры ×2 & Звёздный дар' : 'NEBULA: Wildcards ×2 & Star Gifts';
      badge.style.borderColor = 'rgba(52, 211, 153, 0.5)';
      badge.style.color = '#34d399';
    }
  }

  function spawnMergeShockwave(x, y, color = '#ffffff', radius = 42) {
    const el = document.createElement('div');
    el.className = 'vfx-ring';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.width = (radius * 2) + 'px';
    el.style.height = (radius * 2) + 'px';
    el.style.borderColor = color;
    stageInner.appendChild(el);
    setTimeout(() => el.remove(), 450);
  }

  function spawnMergeParticles(x, y, color) {
    for (let i = 0; i < 14; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 1.5 + Math.random() * 3.5;
      particles.push({
        x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
        life: 25 + Math.random() * 10, maxLife: 35, color
      });
    }
  }

  // --- Singularity & Black Hole Engine ---
  let activeSingularities = [];

  function spawnSingularity(x, y, color = '#a855f7', maxRadius = 45) {
    activeSingularities.push({
      x, y,
      r: 6,
      maxR: maxRadius,
      life: 55,
      maxLife: 55,
      rot: 0,
      color,
      diskParticles: Array.from({ length: 18 }, () => ({
        dist: 12 + Math.random() * (maxRadius * 0.75),
        angle: Math.random() * Math.PI * 2,
        speed: (0.04 + Math.random() * 0.05) * (Math.random() > 0.5 ? 1 : -1),
        size: 1.5 + Math.random() * 2
      }))
    });
    try { AudioManager.playSingularity(); } catch(e) {}
  }

  // --- Audio Synthesis (WebAudio) with Drift Protection & Thematic Melodies ---
  let actx = null;
  let musicGain = null, sfxGain = null;
  let musicEnabled = !(safeStorage.getItem('mergeTowerMusicOff') === '1');
  let musicVolume = Number(safeStorage.getItem('mergeTowerVolMusic') || '75') / 100;
  let sfxVolume = Number(safeStorage.getItem('mergeTowerVolSfx') || '85') / 100;
  let musicStarted = false;
  let musicTimerId = null;
  let nextNoteTime = 0;
  let step16 = 0;
  let loopCount = 0;
  const TEMPO = 124;
  const STEP_DUR = 60 / TEMPO / 4;

  const THEME_TUNES = [
    // 0: Cosmos (Deep space Dorian ambient)
    {
      melody: [60,0,63,0, 67,0,70,0, 72,0,70,0, 67,0,63,0, 62,0,65,0, 68,0,72,0, 74,0,72,0, 68,0,65,0],
      bass:   [36,0,0,0, 0,0,0,0, 46,0,0,0, 0,0,0,0, 44,0,0,0, 0,0,0,0, 43,0,0,0, 0,0,0,0],
      wave: 'sine', bassWave: 'triangle'
    },
    // 1: Reef (Warm oceanic Lydian bells)
    {
      melody: [65,0,69,0, 72,0,76,0, 79,0,76,0, 72,0,69,0, 67,0,71,0, 74,0,77,0, 76,0,72,0, 71,0,67,0],
      bass:   [41,0,0,0, 0,0,0,0, 38,0,0,0, 0,0,0,0, 43,0,0,0, 0,0,0,0, 48,0,0,0, 0,0,0,0],
      wave: 'triangle', bassWave: 'sine'
    },
    // 2: Candy (Bouncy sweet pop Major)
    {
      melody: [67,0,71,0, 74,0,79,0, 76,0,74,0, 71,0,69,0, 67,0,72,0, 76,0,79,0, 78,0,74,0, 69,0,71,0],
      bass:   [43,0,0,0, 0,0,0,0, 48,0,0,0, 0,0,0,0, 40,0,0,0, 0,0,0,0, 45,0,0,0, 0,0,0,0],
      wave: 'square', bassWave: 'triangle'
    },
    // 3: Aurora (Crystal mystical dream arpeggios)
    {
      melody: [69,0,72,0, 76,0,81,0, 83,0,81,0, 76,0,72,0, 65,0,69,0, 72,0,77,0, 76,0,72,0, 69,0,65,0],
      bass:   [45,0,0,0, 0,0,0,0, 41,0,0,0, 0,0,0,0, 38,0,0,0, 0,0,0,0, 40,0,0,0, 0,0,0,0],
      wave: 'sine', bassWave: 'sine'
    }
  ];

  function getAudioCtx() {
    try {
      if (!actx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        actx = new Ctor();
        musicGain = actx.createGain();
        musicGain.gain.value = musicEnabled ? musicVolume * 0.32 : 0;
        musicGain.connect(actx.destination);
        sfxGain = actx.createGain();
        sfxGain.gain.value = sfxVolume * 0.9;
        sfxGain.connect(actx.destination);
      }
      if (actx.state === 'suspended') actx.resume().catch(()=>{});
      return actx;
    } catch(e) { return null; }
  }

  function setMusicVolume(v) {
    musicVolume = Math.max(0, Math.min(1, v));
    safeStorage.setItem('mergeTowerVolMusic', String(Math.round(musicVolume * 100)));
    const textEl = document.getElementById('musicValText');
    if (textEl) textEl.textContent = Math.round(musicVolume * 100) + '%';
    const slider = document.getElementById('musicSlider');
    if (slider) slider.value = Math.round(musicVolume * 100);
    updateMusicContext();
    queueCloudSave();
  }

  // --- Audio Manager (Procedural WebAudio Synthesizer & Sound Effects) ---
  const AudioManager = {
    _lastBtnTapTime: 0,
    _lastPreviewTime: 0,

    getCtx() {
      return getAudioCtx();
    },

    getSfxVolume() {
      return sfxVolume;
    },

    setSfxVolume(v, playPreview = false) {
      sfxVolume = Math.max(0, Math.min(1, v));
      safeStorage.setItem('mergeTowerVolSfx', String(Math.round(sfxVolume * 100)));
      const textEl = document.getElementById('soundValText');
      if (textEl) textEl.textContent = Math.round(sfxVolume * 100) + '%';
      const slider = document.getElementById('soundSlider');
      if (slider && Number(slider.value) !== Math.round(sfxVolume * 100)) {
        slider.value = Math.round(sfxVolume * 100);
      }
      if (sfxGain && actx) {
        sfxGain.gain.setTargetAtTime(sfxVolume * 0.9, actx.currentTime, 0.05);
      }
      queueCloudSave();

      if (playPreview && sfxVolume > 0) {
        const now = performance.now();
        if (now - this._lastPreviewTime > 120) {
          this._lastPreviewTime = now;
          this.playButtonClick();
        }
      }
    },

    getMusicVolume() {
      return musicVolume;
    },

    setMusicVolume(v) {
      setMusicVolume(v);
    },

    // 1. Merge sound effect: rich cheerful procedural pop scaling with tier, combo, and single-drop chain pitch
    playMerge(level = 1, combo = 1, chain = 1) {
      try {
        const ac = getAudioCtx();
        if (!ac || sfxVolume <= 0) return;
        const t0 = ac.currentTime;

        // Dynamic pitch shifting: as player chains multiple merges in a single drop,
        // the pitch ascends along a melodic pentatonic/harmonic scale:
        // Chain 1: 0 st (1.00x)
        // Chain 2: +2 st (1.122x - crisp Major 2nd)
        // Chain 3: +4 st (1.260x - joyful Major 3rd)
        // Chain 4: +7 st (1.498x - ringing Perfect 5th)
        // Chain 5: +9 st (1.682x - Major 6th)
        // Chain 6: +12 st (2.000x - soaring Octave!)
        // Chain 7+: +14, +16, +19, +24 st (celestial upper register)
        const chainSteps = [0, 2, 4, 7, 9, 12, 14, 16, 19, 24];
        const chainIdx = Math.min(chainSteps.length - 1, Math.max(0, (chain || 1) - 1));
        const chainSemitones = chainSteps[chainIdx];
        const chainPitchMult = Math.pow(2, chainSemitones / 12);

        const comboMult = 1 + Math.min(4, Math.max(0, (combo || 1) - 1)) * 0.06;
        const baseFreq = (220 + Math.min(11, level) * 36) * chainPitchMult * comboMult;

        // Main pop body (snappy sine chirp)
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(baseFreq, t0);
        osc.frequency.exponentialRampToValueAtTime(baseFreq * (chain > 2 ? 2.2 : 2.0), t0 + 0.055);
        osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.95, t0 + 0.14);

        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.26, t0 + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);

        osc.connect(g);
        g.connect(sfxGain);
        osc.start(t0);
        osc.stop(t0 + 0.18);

        // Harmonic shimmer overtone for high tier merges, combos, or chained drops
        if (level >= 4 || combo > 1 || chain > 1) {
          const oscHarm = ac.createOscillator();
          const gHarm = ac.createGain();
          oscHarm.type = 'triangle';
          const harmFreq = baseFreq * (chain >= 3 ? 2.0 : 1.5);
          oscHarm.frequency.setValueAtTime(harmFreq, t0);
          oscHarm.frequency.exponentialRampToValueAtTime(harmFreq * 1.6, t0 + 0.1);

          const harmVol = Math.min(0.24, 0.13 + (chain > 1 ? (chain - 1) * 0.025 : 0));
          gHarm.gain.setValueAtTime(0.0001, t0);
          gHarm.gain.exponentialRampToValueAtTime(harmVol, t0 + 0.012);
          gHarm.gain.exponentialRampToValueAtTime(0.0001, t0 + (chain > 2 ? 0.28 : 0.22));

          oscHarm.connect(gHarm);
          gHarm.connect(sfxGain);
          oscHarm.start(t0);
          oscHarm.stop(t0 + (chain > 2 ? 0.30 : 0.24));
        }

        // Celestial chime ping for deep cascade chains (chain >= 3)
        if (chain >= 3) {
          const pingOsc = ac.createOscillator();
          const pingGain = ac.createGain();
          pingOsc.type = 'sine';
          const pingFreq = baseFreq * 2.5;
          pingOsc.frequency.setValueAtTime(pingFreq, t0 + 0.02);
          pingOsc.frequency.exponentialRampToValueAtTime(pingFreq * 1.2, t0 + 0.12);

          pingGain.gain.setValueAtTime(0.0001, t0 + 0.02);
          pingGain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.035);
          pingGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);

          pingOsc.connect(pingGain);
          pingGain.connect(sfxGain);
          pingOsc.start(t0 + 0.02);
          pingOsc.stop(t0 + 0.26);
        }
      } catch(e) {}
    },

    // Procedural Sub-Bass Punch for massive merges and orbital impacts
    playSubBassPunch(level = 5) {
      try {
        const ac = getAudioCtx();
        if (!ac || sfxVolume <= 0) return;
        const t0 = ac.currentTime;
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = 'sine';
        const startFreq = 125 + Math.min(5, level - 4) * 12;
        osc.frequency.setValueAtTime(startFreq, t0);
        osc.frequency.exponentialRampToValueAtTime(28, t0 + 0.24);

        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.32, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);

        osc.connect(g);
        g.connect(sfxGain);
        osc.start(t0);
        osc.stop(t0 + 0.3);
      } catch(e) {}
    },

    // Procedural rhythmic tension heartbeat when balls cross danger line
    playDangerHeartbeat(ratio = 0.5) {
      try {
        const ac = getAudioCtx();
        if (!ac || sfxVolume <= 0) return;
        const t0 = ac.currentTime;
        [0, 0.11].forEach((offset, idx) => {
          const osc = ac.createOscillator();
          const g = ac.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(idx === 0 ? 85 : 70, t0 + offset);
          osc.frequency.exponentialRampToValueAtTime(32, t0 + offset + 0.08);

          g.gain.setValueAtTime(0.0001, t0 + offset);
          g.gain.exponentialRampToValueAtTime(0.16 + ratio * 0.12, t0 + offset + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.09);

          osc.connect(g);
          g.connect(sfxGain);
          osc.start(t0 + offset);
          osc.stop(t0 + offset + 0.11);
        });
      } catch(e) {}
    },

    // 2. Game Over sound effect: dramatic descending impact & somber chord
    playGameOver() {
      try {
        const ac = getAudioCtx();
        if (!ac || sfxVolume <= 0) return;
        const t0 = ac.currentTime;

        // Sub bass heavy impact
        const subOsc = ac.createOscillator();
        const subGain = ac.createGain();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(150, t0);
        subOsc.frequency.exponentialRampToValueAtTime(32, t0 + 0.36);

        subGain.gain.setValueAtTime(0.0001, t0);
        subGain.gain.exponentialRampToValueAtTime(0.38, t0 + 0.012);
        subGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);

        subOsc.connect(subGain);
        subGain.connect(sfxGain);
        subOsc.start(t0);
        subOsc.stop(t0 + 0.48);

        // Minor tritone / lament descending tone
        const midOsc = ac.createOscillator();
        const midGain = ac.createGain();
        midOsc.type = 'triangle';
        midOsc.frequency.setValueAtTime(293.66, t0 + 0.03); // D4
        midOsc.frequency.exponentialRampToValueAtTime(207.65, t0 + 0.26); // G#3 / tritone
        midOsc.frequency.exponentialRampToValueAtTime(146.83, t0 + 0.55); // D3

        midGain.gain.setValueAtTime(0.0001, t0 + 0.03);
        midGain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.06);
        midGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);

        midOsc.connect(midGain);
        midGain.connect(sfxGain);
        midOsc.start(t0 + 0.03);
        midOsc.stop(t0 + 0.62);
      } catch(e) {}
    },

    // 3. Button Click sound effect: crisp, tactile, modern UI tap feedback
    playButtonClick() {
      const now = performance.now();
      if (now - this._lastBtnTapTime < 45) return;
      this._lastBtnTapTime = now;

      try {
        const ac = getAudioCtx();
        if (!ac || sfxVolume <= 0) return;
        const t0 = ac.currentTime;

        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(520, t0);
        osc.frequency.exponentialRampToValueAtTime(320, t0 + 0.038);

        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.048);

        osc.connect(g);
        g.connect(sfxGain);
        osc.start(t0);
        osc.stop(t0 + 0.052);
      } catch(e) {}
    },

    // 4. Singularity & Black Hole sound: deep space gravitational collapse & resonance
    playSingularity() {
      try {
        const ac = getAudioCtx();
        if (!ac || sfxVolume <= 0) return;
        const t0 = ac.currentTime;

        // Sub-bass gravitational vortex suck
        const sub = ac.createOscillator();
        const subG = ac.createGain();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(120, t0);
        sub.frequency.exponentialRampToValueAtTime(32, t0 + 0.55);
        sub.frequency.exponentialRampToValueAtTime(18, t0 + 1.1);

        subG.gain.setValueAtTime(0.0001, t0);
        subG.gain.exponentialRampToValueAtTime(0.35, t0 + 0.05);
        subG.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.15);

        sub.connect(subG); subG.connect(sfxGain);
        sub.start(t0); sub.stop(t0 + 1.2);

        // Cosmic event horizon resonance ring
        const ring = ac.createOscillator();
        const ringG = ac.createGain();
        ring.type = 'triangle';
        ring.frequency.setValueAtTime(260, t0);
        ring.frequency.exponentialRampToValueAtTime(65, t0 + 0.7);

        ringG.gain.setValueAtTime(0.0001, t0);
        ringG.gain.exponentialRampToValueAtTime(0.18, t0 + 0.04);
        ringG.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.85);

        ring.connect(ringG); ringG.connect(sfxGain);
        ring.start(t0); ring.stop(t0 + 0.9);
      } catch(e) {}
    },

    // Additional procedural sounds:
    playThud() {
      try {
        const ac = getAudioCtx();
        if (!ac || sfxVolume <= 0) return;
        const t0 = ac.currentTime;
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(140, t0);
        osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.12);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.28, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
        osc.connect(g); g.connect(sfxGain);
        osc.start(t0); osc.stop(t0 + 0.18);
      } catch(e){}
    },

    playStarChime(idx = 0) {
      try {
        const ac = getAudioCtx();
        if (!ac || sfxVolume <= 0) return;
        const t0 = ac.currentTime;
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = 'triangle';
        const notes = [523.25, 659.25, 783.99, 1046.5];
        const freq = notes[idx % notes.length];
        osc.frequency.setValueAtTime(freq, t0);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.24, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
        osc.connect(g); g.connect(sfxGain);
        osc.start(t0); osc.stop(t0 + 0.38);
      } catch(e){}
    },

    playCharChirp() {
      try {
        const ac = getAudioCtx();
        if (!ac || sfxVolume <= 0) return;
        const t0 = ac.currentTime;
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(620, t0);
        osc.frequency.exponentialRampToValueAtTime(940, t0 + 0.07);
        osc.frequency.exponentialRampToValueAtTime(1280, t0 + 0.14);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
        osc.connect(g); g.connect(sfxGain);
        osc.start(t0); osc.stop(t0 + 0.22);
      } catch(e){}
    },

    playCharFlip() {
      try {
        const ac = getAudioCtx();
        if (!ac || sfxVolume <= 0) return;
        const t0 = ac.currentTime;
        const osc1 = ac.createOscillator();
        const osc2 = ac.createOscillator();
        const g = ac.createGain();
        osc1.type = 'sine';
        osc2.type = 'triangle';
        osc1.frequency.setValueAtTime(440, t0);
        osc1.frequency.exponentialRampToValueAtTime(1100, t0 + 0.16);
        osc1.frequency.exponentialRampToValueAtTime(1600, t0 + 0.3);
        osc2.frequency.setValueAtTime(880, t0);
        osc2.frequency.exponentialRampToValueAtTime(1760, t0 + 0.28);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
        osc1.connect(g); osc2.connect(g); g.connect(sfxGain);
        osc1.start(t0); osc2.start(t0);
        osc1.stop(t0 + 0.36); osc2.stop(t0 + 0.36);
      } catch(e){}
    },

    playArchonResonance() {
      try {
        const ac = getAudioCtx();
        if (!ac || sfxVolume <= 0) return;
        const t0 = ac.currentTime;
        // Tri-chord celestial harmony (Solfeggio 528Hz + 792Hz + 1056Hz)
        [528, 792, 1056].forEach((freq, idx) => {
          const osc = ac.createOscillator();
          const g = ac.createGain();
          osc.type = idx === 0 ? 'sine' : (idx === 1 ? 'triangle' : 'sine');
          osc.frequency.setValueAtTime(freq, t0);
          osc.frequency.exponentialRampToValueAtTime(freq * 1.05, t0 + 0.4);
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.exponentialRampToValueAtTime(0.12 / (idx + 1), t0 + 0.03);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
          osc.connect(g);
          g.connect(sfxGain);
          osc.start(t0);
          osc.stop(t0 + 0.58);
        });
      } catch(e) {}
    },
    playFeverStart() {
      try {
        const ac = getAudioCtx();
        if (!ac || sfxVolume <= 0) return;
        const t0 = ac.currentTime;
        [440, 554, 659, 880, 1108].forEach((f, i) => {
          const osc = ac.createOscillator();
          const g = ac.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(f, t0 + i * 0.05);
          osc.frequency.exponentialRampToValueAtTime(f * 1.4, t0 + i * 0.05 + 0.28);
          g.gain.setValueAtTime(0.0001, t0 + i * 0.05);
          g.gain.exponentialRampToValueAtTime(0.18, t0 + i * 0.05 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.05 + 0.35);
          osc.connect(g); g.connect(sfxGain);
          osc.start(t0 + i * 0.05); osc.stop(t0 + i * 0.05 + 0.38);
        });
      } catch(e) {}
    },
    playFeverMerge(level = 1, chain = 1) {
      try {
        const ac = getAudioCtx();
        if (!ac || sfxVolume <= 0) return;
        const t0 = ac.currentTime;
        const root = 523.25;
        const scales = [1, 9/8, 5/4, 3/2, 5/3, 2, 9/4, 5/2];
        const chainSteps = [0, 2, 4, 7, 9, 12, 14, 16];
        const chainIdx = Math.min(chainSteps.length - 1, Math.max(0, (chain || 1) - 1));
        const chainMult = Math.pow(2, chainSteps[chainIdx] / 12);
        const pitch = root * (scales[level % scales.length] || 1) * chainMult;
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(pitch, t0);
        osc.frequency.exponentialRampToValueAtTime(pitch * 1.25, t0 + 0.16);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
        osc.connect(g); g.connect(sfxGain);
        osc.start(t0); osc.stop(t0 + 0.26);
      } catch(e) {}
    },
    playRescueVortex() {
      try {
        const ac = getAudioCtx();
        if (!ac || sfxVolume <= 0) return;
        const t0 = ac.currentTime;
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(260, t0);
        osc.frequency.exponentialRampToValueAtTime(50, t0 + 0.38);
        osc.frequency.exponentialRampToValueAtTime(220, t0 + 0.7);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.75);
        osc.connect(g); g.connect(sfxGain);
        osc.start(t0); osc.stop(t0 + 0.8);
      } catch(e) {}
    },
    playWheelTick() {
      try {
        const ac = getAudioCtx();
        if (!ac || sfxVolume <= 0) return;
        const t0 = ac.currentTime;
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(750 + Math.random() * 150, t0);
        osc.frequency.exponentialRampToValueAtTime(280, t0 + 0.04);
        g.gain.setValueAtTime(0.14, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.04);
        osc.connect(g); g.connect(sfxGain);
        osc.start(t0); osc.stop(t0 + 0.045);
      } catch(e) {}
    },
    playWheelWin() {
      try {
        const ac = getAudioCtx();
        if (!ac || sfxVolume <= 0) return;
        const t0 = ac.currentTime;
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
          const osc = ac.createOscillator();
          const g = ac.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, t0 + idx * 0.08);
          g.gain.setValueAtTime(0.0001, t0 + idx * 0.08);
          g.gain.exponentialRampToValueAtTime(0.2, t0 + idx * 0.08 + 0.03);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + idx * 0.08 + 0.45);
          osc.connect(g); g.connect(sfxGain);
          osc.start(t0 + idx * 0.08); osc.stop(t0 + idx * 0.08 + 0.5);
        });
      } catch(e) {}
    }
  };

  function setSfxVolume(v) {
    AudioManager.setSfxVolume(v);
  }

  function playButtonTap() {
    AudioManager.playButtonClick();
  }

  function playThud() {
    AudioManager.playThud();
  }

  function playStarChime(idx = 0) {
    AudioManager.playStarChime(idx);
  }

  function playPop(level, combo = 1, chain = 1) {
    AudioManager.playMerge(level, combo, chain);
  }

  function playCharChirp() {
    AudioManager.playCharChirp();
  }

  function playCharFlip() {
    AudioManager.playCharFlip();
  }

  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function scheduleTone(freq, time, dur, type, peak) {
    const ac = getAudioCtx();
    if (!ac) return;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g); g.connect(musicGain);
    osc.start(time); osc.stop(time + dur + 0.02);
  }

  function musicScheduler() {
    try {
      const ac = getAudioCtx();
      if (!ac) return;
      if (nextNoteTime < ac.currentTime) nextNoteTime = ac.currentTime + 0.02;
      const tune = THEME_TUNES[currentLocIdx % THEME_TUNES.length] || THEME_TUNES[0];
      while (nextNoteTime < ac.currentTime + 0.12) {
        const m = tune.melody[step16 % tune.melody.length];
        if (m) scheduleTone(midiToFreq(m), nextNoteTime, STEP_DUR * 1.6, tune.wave, 0.08 * musicVolume);
        const b = tune.bass[step16 % tune.bass.length];
        if (b) scheduleTone(midiToFreq(b), nextNoteTime, STEP_DUR * 3.5, tune.bassWave, 0.14 * musicVolume);
        nextNoteTime += STEP_DUR;
        step16 = (step16 + 1) % 32;
        if (step16 === 0) loopCount++;
      }
    } catch(e){}
  }

  function startMusic() {
    if (musicStarted) return;
    musicStarted = true;
    const ac = getAudioCtx();
    if (!ac) return;
    step16 = 0;
    nextNoteTime = ac.currentTime + 0.05;
    musicTimerId = setInterval(musicScheduler, 25);
  }

  function updateMusicContext() {
    if (!musicStarted) return;
    const audible = musicEnabled && running && !gameOver;
    try {
      if (audible) {
        const ac = getAudioCtx();
        if (ac && musicGain) musicGain.gain.setTargetAtTime(musicVolume * 0.32, ac.currentTime, 0.1);
        if (!musicTimerId) {
          nextNoteTime = ac.currentTime + 0.05;
          musicTimerId = setInterval(musicScheduler, 25);
        }
      } else {
        if (musicGain && actx) musicGain.gain.setTargetAtTime(0, actx.currentTime, 0.1);
        if (musicTimerId) { clearInterval(musicTimerId); musicTimerId = null; }
      }
    } catch(e){}
  }

  function setMusicEnabled(on) {
    musicEnabled = on;
    safeStorage.setItem('mergeTowerMusicOff', on ? '0' : '1');
    queueCloudSave();
    updateMusicContext();
    updateMusicBtn();
  }
  function updateMusicBtn() {
    const btn = document.getElementById('soundToggleBtn');
    if (btn) btn.innerHTML = (musicEnabled ? '🔊 ' : '🔇 ') + `<span>${t(musicEnabled ? 'on' : 'off')}</span>`;
  }

  // --- Character Mascot ("Мерджик" / Brand Masterpiece) ---
  const CHAR = {
    x: 0,
    y: 0,
    cx: 0,
    cy: 0,
    prevX: 0,
    vx: 0,
    tilt: 0,
    flipT: 0,
    blinkAt: 0,
    throwT: 0,
    danceUntil: 0,
    petT: 0,
    cheerT: 0,
    jetParticles: [],
    sparks: [],
    speechText: '',
    speechUntil: 0
  };

  function triggerCharThrow() { CHAR.throwT = 1; }
  function triggerCharDance() { CHAR.danceUntil = performance.now() + 2800; }
  function triggerCharCheer() {
    CHAR.cheerT = 1;
    for (let i = 0; i < 3; i++) {
      CHAR.sparks.push({
        x: (Math.random() - 0.5) * 20,
        y: -24 - Math.random() * 8,
        vx: (Math.random() - 0.5) * 2.2,
        vy: -2 - Math.random() * 1.5,
        life: 1,
        char: i % 2 === 0 ? '✦' : '⭐',
        color: '#ffd23f'
      });
    }
  }

  const MASCOT_QUOTES = {
    lumi: {
      ru: [
        '✦ Звёзды поют для нас! ✦',
        '✦ Свет ведёт к победе! ✦',
        '✦ Эфир полон чистой магии! ✦',
        '✦ Слияние прекрасно, как рассвет! ✦'
      ],
      en: [
        '✦ The stars sing for us! ✦',
        '✦ Light guides our victory! ✦',
        '✦ The Aether is pure magic! ✦',
        '✦ Fusion is so radiant! ✦'
      ]
    },
    bot: {
      ru: [
        '✦ Системы в норме! Слияние 100%! ✦',
        '✦ Траектория рассчитана идеально! ✦',
        '✦ Антиграв стабилизирован! ✦',
        '✦ Нова готова к рекорду! ✦'
      ],
      en: [
        '✦ Systems nominal! Fusion 100%! ✦',
        '✦ Trajectory computed perfectly! ✦',
        '✦ Anti-grav drive stabilized! ✦',
        '✦ Nova is ready for high score! ✦'
      ]
    },
    dragon: {
      ru: [
        '✦ Р-р-мяу! Пламя созвездий горит! ✦',
        '✦ Сокровища космоса ждут нас! ✦',
        '✦ Сила звёздных драконов непобедима! ✦',
        '✦ Никакая гравитация не удержит! ✦'
      ],
      en: [
        '✦ Rawr! Constellation flame ignited! ✦',
        '✦ Cosmic treasures await us! ✦',
        '✦ Celestial dragons are undefeated! ✦',
        '✦ No gravity can hold us down! ✦'
      ]
    },
    knight: {
      ru: [
        '✦ Честь Цитадели несокрушима! ✦',
        '✦ Вперёд, к звёздному триумфу! ✦',
        '✦ Клинок света рассечёт тьму! ✦',
        '✦ Сингулярность будет покорена! ✦'
      ],
      en: [
        '✦ Citadel honor is unbreakable! ✦',
        '✦ Forward, to stellar triumph! ✦',
        '✦ Blade of light cuts the void! ✦',
        '✦ Singularity shall bow to us! ✦'
      ]
    }
  };

  function triggerCharPet() {
    CHAR.petT = 1;
    CHAR.flipT = 1; // 360° spin
    triggerHaptic([25, 40, 25]);
    try { AudioManager.playArchonResonance(); } catch(e) {}
    try { AudioManager.playCharFlip(); } catch(e) {}

    const mascotPack = MASCOT_QUOTES[currentMascot] || MASCOT_QUOTES.lumi;
    const list = currentLang === 'ru' ? mascotPack.ru : mascotPack.en;
    CHAR.speechText = list[Math.floor(Math.random() * list.length)];
    CHAR.speechUntil = performance.now() + 2000;

    for (let i = 0; i < 14; i++) {
      const angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.2;
      const speed = 2.0 + Math.random() * 1.8;
      CHAR.sparks.push({
        x: Math.cos(angle) * 16,
        y: Math.sin(angle) * 16 - 10,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        life: 1,
        char: i % 3 === 0 ? '✦' : (i % 3 === 1 ? '✨' : '⭐'),
        color: currentMascot === 'bot' ? '#38bdf8' : (currentMascot === 'dragon' ? '#f59e0b' : (currentMascot === 'knight' ? '#ffd23f' : '#a855f7'))
      });
    }
  }

  function drawMiniStar(ctx, cx, cy, r, color) {
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rad = i % 2 === 0 ? r : r * 0.38;
      const ang = (i * Math.PI) / 4;
      const px = cx + Math.cos(ang) * rad;
      const py = cy + Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // --- MERGE TOWER MASCOTS (4 ICONIC BRAND ARCHETYPES) ---
  function drawMascotCharacter(ctx, {
    mascot = currentMascot || 'lumi',
    cx = 0,
    cy = 0,
    scale = 1.0,
    tilt = 0,
    flipProgress = 0,
    now = performance.now(),
    house = currentHouse || 'chrono',
    skin = equippedSkin || 'default',
    lookX = 0,
    lookY = 0,
    aiming = false,
    happy = false,
    worried = false,
    ballColor = '#4deeea'
  }) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    if (flipProgress > 0) {
      const flipAngle = (1 - flipProgress) * Math.PI * 2;
      ctx.rotate(flipAngle);
    } else {
      ctx.rotate(tilt);
    }

    // Color palette based on Great House and Skin
    let primaryColor = '#1d4ed8'; // Royal Sapphire
    let glowColor = '#38bdf8';    // Bright Cyan
    let accentColor = '#ffd23f';  // Celestial Gold
    let darkColor = '#060a1c';

    if (house === 'singularity') {
      primaryColor = '#6b21a8';
      glowColor = '#e879f9';
      accentColor = '#f43f5e';
      darkColor = '#090314';
    } else if (house === 'pulsar') {
      primaryColor = '#c2410c';
      glowColor = '#fbbf24';
      accentColor = '#ffd23f';
      darkColor = '#140502';
    } else if (house === 'nebula') {
      primaryColor = '#047857';
      glowColor = '#34d399';
      accentColor = '#a7f3d0';
      darkColor = '#02120e';
    }

    if (skin === 'gold') {
      primaryColor = '#b45309';
      glowColor = '#fde047';
      accentColor = '#ffd23f';
    } else if (skin === 'shadow') {
      primaryColor = '#3b0764';
      glowColor = '#c084fc';
      accentColor = '#a855f7';
    } else if (skin === 'rainbow') {
      const hue = (now * 0.05) % 360;
      primaryColor = `hsl(${hue}, 85%, 45%)`;
      glowColor = `hsl(${(hue + 60) % 360}, 100%, 65%)`;
      accentColor = `hsl(${(hue + 120) % 360}, 100%, 70%)`;
    }

    // =========================================================================
    // VARIANT 1: LUMI — АСТРАЛЬНЫЙ ЗВЁЗДНЫЙ ДУХ (Ethereal Cosmic Wisp)
    // =========================================================================
    if (mascot === 'lumi') {
      // Soft breathing aura disc
      const haloR = 24 + Math.sin(now * 0.003) * 2;
      const hGrad = ctx.createRadialGradient(0, 0, 4, 0, 0, haloR);
      hGrad.addColorStop(0, glowColor);
      hGrad.addColorStop(0.5, 'rgba(56, 189, 248, 0.25)');
      hGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = hGrad;
      ctx.beginPath();
      ctx.arc(0, 0, haloR, 0, Math.PI * 2);
      ctx.fill();

      // Fluid comet spirit tail waving
      const tailWave = Math.sin(now * 0.005) * 4;
      ctx.beginPath();
      ctx.moveTo(-16, -2);
      ctx.bezierCurveTo(-15, 12, -7 + tailWave, 22, tailWave * 1.4, 28);
      ctx.bezierCurveTo(7 + tailWave, 22, 15, 12, 16, -2);
      ctx.arc(0, -2, 16, 0, Math.PI, true);
      ctx.closePath();

      const bodyGrad = ctx.createRadialGradient(-4, -6, 2, 0, 4, 22);
      bodyGrad.addColorStop(0, '#ffffff');
      bodyGrad.addColorStop(0.32, glowColor);
      bodyGrad.addColorStop(0.75, primaryColor);
      bodyGrad.addColorStop(1, darkColor);
      ctx.fillStyle = bodyGrad;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = accentColor;
      ctx.stroke();

      // Two elegant spirit tendril antennae
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(s * 6, -15);
        ctx.quadraticCurveTo(s * 15, -26, s * 9, -30);
        ctx.quadraticCurveTo(s * 5, -22, s * 2, -16);
        ctx.fillStyle = glowColor;
        ctx.fill();
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1.0;
        ctx.stroke();
        ctx.restore();
      }

      // Floating 4-pointed Star Crown
      const starY = -28 + Math.sin(now * 0.004) * 2;
      drawMiniStar(ctx, 0, starY, 4.5, '#ffd23f');

      // Galaxy Star Eyes
      for (const s of [-1, 1]) {
        const ex = s * 6.5;
        const ey = -3;
        if (happy) {
          ctx.beginPath();
          ctx.arc(ex, ey + 1, 4.2, Math.PI * 1.1, Math.PI * 1.9);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.2;
          ctx.lineCap = 'round';
          ctx.stroke();
        } else if (worried) {
          ctx.beginPath();
          ctx.ellipse(ex + lookX * 0.25, ey + lookY * 0.25, 4.4, 5.5, 0, 0, Math.PI * 2);
          ctx.fillStyle = '#030712';
          ctx.fill();
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(ex + lookX * 0.35, ey + lookY * 0.35, 1.8, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.ellipse(ex + lookX * 0.3, ey + lookY * 0.3, 4.2, 5.2, 0, 0, Math.PI * 2);
          ctx.fillStyle = '#050a1c';
          ctx.fill();
          ctx.strokeStyle = glowColor;
          ctx.lineWidth = 1.0;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(ex + lookX * 0.3, ey + lookY * 0.3 + 1, 2.6, 0.2 * Math.PI, 0.8 * Math.PI);
          ctx.strokeStyle = glowColor;
          ctx.lineWidth = 1.6;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(ex + lookX * 0.4 + 1.2, ey + lookY * 0.4 - 1.3, 1.4, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        }

        // Glowing cheeks
        ctx.beginPath();
        ctx.ellipse(s * 10, 4.5, 3.2, 1.8, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 120, 180, 0.55)';
        ctx.fill();
      }

      // Cute smile
      ctx.beginPath();
      ctx.arc(0, 3.2, 3.6, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Floating droplet hands
      for (const s of [-1, 1]) {
        const hx = s * 20;
        const hy = 4 + Math.sin(now * 0.004 + s) * 2.5;
        ctx.beginPath();
        ctx.ellipse(hx, hy, 4, 3, s * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = glowColor;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1.0;
        ctx.stroke();
      }

      // Orbiting stardust motes
      for (let m = 0; m < 2; m++) {
        const theta = (now * 0.0025) + (m * Math.PI);
        const ox = Math.cos(theta) * 26;
        const oy = Math.sin(theta) * 8 + 4;
        drawMiniStar(ctx, ox, oy, 2.5, m === 0 ? '#ffd23f' : '#4deeea');
      }
    }

    // =========================================================================
    // VARIANT 2: NOVA — АСТРО-БОТ / КИБЕР-ФАМИЛЬЯР (Sleek Sci-Fi Droid)
    // =========================================================================
    else if (mascot === 'bot') {
      // Repulsor energy base
      ctx.beginPath();
      ctx.ellipse(0, 20, 15, 4.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(6, 12, 34, 0.85)';
      ctx.fill();
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 1.6;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Porcelain ceramic capsule shell
      ctx.beginPath();
      ctx.roundRect(-16, -18, 32, 36, 16);
      const botGrad = ctx.createLinearGradient(-16, -18, 16, 18);
      botGrad.addColorStop(0, '#ffffff');
      botGrad.addColorStop(0.45, '#e2e8f0');
      botGrad.addColorStop(0.85, '#94a3b8');
      botGrad.addColorStop(1, '#334155');
      ctx.fillStyle = botGrad;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Aerodynamic ear-sensor pylons
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.roundRect(s * 17 - (s > 0 ? 0 : 4), -14, 4, 12, 2);
        ctx.fillStyle = '#1e293b';
        ctx.fill();
        ctx.strokeStyle = glowColor;
        ctx.lineWidth = 1.0;
        ctx.stroke();
        // Power slit
        ctx.beginPath();
        ctx.arc(s * 18, -8, 1.4, 0, Math.PI * 2);
        ctx.fillStyle = ballColor;
        ctx.shadowColor = ballColor;
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Curved Obsidian Visor
      ctx.beginPath();
      ctx.roundRect(-12, -12, 24, 16, 8);
      ctx.fillStyle = '#030712';
      ctx.fill();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
      ctx.lineWidth = 1.0;
      ctx.stroke();

      // Glass specular reflection arc
      ctx.beginPath();
      ctx.ellipse(-3, -9, 7, 2.4, -0.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fill();

      // LED Eyes on Visor
      for (const s of [-1, 1]) {
        const ex = s * 5.5 + lookX * 0.3;
        const ey = -4.5 + lookY * 0.3;
        if (happy) {
          ctx.beginPath();
          ctx.arc(ex, ey, 3.2, Math.PI * 1.1, Math.PI * 1.9);
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2.0;
          ctx.lineCap = 'round';
          ctx.stroke();
        } else if (aiming) {
          // Precision crosshair pupil
          ctx.beginPath();
          ctx.arc(ex, ey, 3.0, 0, Math.PI * 2);
          ctx.strokeStyle = '#ffd23f';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(ex, ey, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = '#ffd23f';
          ctx.fill();
        } else if (worried) {
          ctx.beginPath();
          ctx.moveTo(ex - 2.5, ey);
          ctx.lineTo(ex, ey - 2);
          ctx.lineTo(ex + 2.5, ey);
          ctx.strokeStyle = '#f43f5e';
          ctx.lineWidth = 1.8;
          ctx.lineCap = 'round';
          ctx.stroke();
        } else {
          // Digital pill LED eyes
          ctx.beginPath();
          ctx.roundRect(ex - 2.2, ey - 3.2, 4.4, 6.4, 2.2);
          ctx.fillStyle = '#38bdf8';
          ctx.shadowColor = '#38bdf8';
          ctx.shadowBlur = 8;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.beginPath();
          ctx.arc(ex, ey - 1, 1.1, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        }
      }

      // Magnetic floating hands
      for (const s of [-1, 1]) {
        const hx = s * 21;
        const hy = 3 + Math.sin(now * 0.005 + s) * 2;
        ctx.beginPath();
        ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = '#334155';
        ctx.fill();
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(hx, hy, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = glowColor;
        ctx.fill();
      }
    }

    // =========================================================================
    // VARIANT 3: AETHER — ЗВЁЗДНЫЙ ДРАКОНЧИК (Celestial Star Drake)
    // =========================================================================
    else if (mascot === 'dragon') {
      // Fluttering Constellation Wings
      const flap = Math.sin(now * 0.015) * 0.26;
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(s * 10, -2);
        ctx.scale(s, 1 + flap);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(10, -18, 22, -14, 25, -6);
        ctx.bezierCurveTo(22, 0, 16, 6, 0, 4);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.45)';
        ctx.fill();
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        // Wing star constellation nodes
        ctx.beginPath();
        ctx.arc(16, -10, 1.4, 0, Math.PI * 2);
        ctx.arc(22, -5, 1.4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd23f';
        ctx.fill();
        ctx.restore();
      }

      // Wiggling Star Tail
      const tailS = Math.sin(now * 0.008) * 3.5;
      ctx.beginPath();
      ctx.moveTo(8, 14);
      ctx.bezierCurveTo(18, 16, 22 + tailS, 8, 21 + tailS * 1.2, 2);
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 4.0;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = accentColor;
      ctx.stroke();
      drawMiniStar(ctx, 22 + tailS * 1.2, 2, 4.2, '#ffd23f');

      // Dragon Body
      ctx.beginPath();
      ctx.arc(0, 0, 17, 0, Math.PI * 2);
      const dragGrad = ctx.createRadialGradient(-4, -6, 2, 0, 0, 18);
      dragGrad.addColorStop(0, '#ffffff');
      dragGrad.addColorStop(0.3, glowColor);
      dragGrad.addColorStop(0.75, primaryColor);
      dragGrad.addColorStop(1, darkColor);
      ctx.fillStyle = dragGrad;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Soft Golden Belly Plate
      ctx.beginPath();
      ctx.ellipse(0, 7, 9, 8, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(254, 240, 138, 0.35)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 210, 63, 0.6)';
      ctx.lineWidth = 1.0;
      ctx.stroke();

      // Faceted Crystalline Horns
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * 5, -14);
        ctx.lineTo(s * 15, -28);
        ctx.lineTo(s * 10, -28);
        ctx.lineTo(s * 2, -16);
        ctx.closePath();
        ctx.fillStyle = accentColor;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.0;
        ctx.stroke();
      }

      // Dragon Eyes
      for (const s of [-1, 1]) {
        const ex = s * 6.5;
        const ey = -2.5;
        if (happy) {
          ctx.beginPath();
          ctx.arc(ex, ey + 1, 4.2, Math.PI * 1.1, Math.PI * 1.9);
          ctx.strokeStyle = '#ffd23f';
          ctx.lineWidth = 2.2;
          ctx.lineCap = 'round';
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.ellipse(ex + lookX * 0.3, ey + lookY * 0.3, 4.4, 5.2, 0, 0, Math.PI * 2);
          ctx.fillStyle = '#ffd23f';
          ctx.fill();
          ctx.strokeStyle = '#78350f';
          ctx.lineWidth = 1.0;
          ctx.stroke();
          // Vertical slit pupil
          ctx.beginPath();
          ctx.ellipse(ex + lookX * 0.35, ey + lookY * 0.35, aiming ? 1.0 : 1.8, 4.2, 0, 0, Math.PI * 2);
          ctx.fillStyle = '#050a1c';
          ctx.fill();
          // Specular glint
          ctx.beginPath();
          ctx.arc(ex + lookX * 0.4 + 1.2, ey + lookY * 0.4 - 1.4, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        }
      }

      // Snout with tiny tooth
      ctx.beginPath();
      ctx.arc(0, 4, 3.5, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Tiny white tooth
      ctx.beginPath();
      ctx.moveTo(1.5, 5.0);
      ctx.lineTo(2.8, 6.8);
      ctx.lineTo(3.8, 5.0);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // Floating cute paws
      for (const s of [-1, 1]) {
        const px = s * 19;
        const py = 6 + Math.sin(now * 0.005 + s) * 2;
        ctx.beginPath();
        ctx.ellipse(px, py, 4, 3, s * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = primaryColor;
        ctx.fill();
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1.0;
        ctx.stroke();
      }
    }

    // =========================================================================
    // VARIANT 4: ORION — ЗВЁЗДНЫЙ РЫЦАРЬ (The Celestial Wanderer)
    // =========================================================================
    else if (mascot === 'knight') {
      // Flowing Cosmic Silk Scarf
      const wave1 = Math.sin(now * 0.006) * 4;
      const wave2 = Math.sin(now * 0.006 + 1) * 6;
      ctx.beginPath();
      ctx.moveTo(-8, 8);
      ctx.bezierCurveTo(-18, 12, -24 + wave1, 16, -30 + wave2, 22);
      ctx.lineTo(-24 + wave2, 25);
      ctx.bezierCurveTo(-18 + wave1, 18, -10, 14, -3, 10);
      ctx.closePath();
      const scarfGrad = ctx.createLinearGradient(-8, 8, -30, 24);
      scarfGrad.addColorStop(0, accentColor);
      scarfGrad.addColorStop(1, glowColor);
      ctx.fillStyle = scarfGrad;
      ctx.shadowColor = accentColor;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Porcelain Star Mask with Crescent Crests
      ctx.beginPath();
      ctx.moveTo(-14, 2);
      ctx.bezierCurveTo(-15, -12, -10, -22, -12, -31); // Left crest
      ctx.quadraticCurveTo(-7, -24, -4, -17);
      ctx.lineTo(0, -19); // Center dip
      ctx.lineTo(4, -17);
      ctx.quadraticCurveTo(7, -24, 12, -31); // Right crest
      ctx.bezierCurveTo(10, -22, 15, -12, 14, 2);
      ctx.bezierCurveTo(12, 14, -12, 14, -14, 2);
      ctx.closePath();

      const maskGrad = ctx.createRadialGradient(-3, -8, 2, 0, 0, 22);
      maskGrad.addColorStop(0, '#ffffff');
      maskGrad.addColorStop(0.5, '#f1f5f9');
      maskGrad.addColorStop(0.85, '#cbd5e1');
      maskGrad.addColorStop(1, '#334155');
      ctx.fillStyle = maskGrad;
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = '#1e293b';
      ctx.stroke();

      // Forehead Citadel Star
      drawMiniStar(ctx, 0, -11, 3.2, '#ffd23f');

      // Deep Void Eyes with Starlight Pupils
      for (const s of [-1, 1]) {
        const ex = s * 6.5;
        const ey = -2.5;
        ctx.beginPath();
        ctx.ellipse(ex + lookX * 0.3, ey + lookY * 0.3, 3.8, 5.0, s * 0.15, 0, Math.PI * 2);
        ctx.fillStyle = '#050a1c';
        ctx.fill();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.0;
        ctx.stroke();

        // Piercing Starlight pupil
        ctx.beginPath();
        ctx.arc(ex + lookX * 0.4, ey + lookY * 0.4, 1.6, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 4;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Midnight Mantle with Golden Medallion
      ctx.beginPath();
      ctx.ellipse(0, 14, 11, 4, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#0a0f24';
      ctx.fill();
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Floating Plated Gauntlets
      for (const s of [-1, 1]) {
        const gx = s * 21;
        const gy = 5 + Math.sin(now * 0.005 + s) * 2;
        ctx.beginPath();
        ctx.roundRect(gx - 3.5, gy - 4.5, 7, 9, 3);
        ctx.fillStyle = '#1e293b';
        ctx.fill();
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        // Palm gem
        ctx.beginPath();
        ctx.arc(gx, gy, 1.4, 0, Math.PI * 2);
        ctx.fillStyle = glowColor;
        ctx.fill();
      }
    }

    ctx.restore();
  }
  const drawAstralArchon = drawMascotCharacter;

  function drawCharacter() {
    if (!TUBE_TOP) return;
    const now = performance.now();
    const loc = LOCATIONS[currentLocIdx] || LOCATIONS[0];
    const dancing = now < CHAR.danceUntil;

    // Smooth movement & head tilt following player aim
    const targetX = (currentBall && currentBall.isFalling) || pointerDown
      ? W / 2 + (clampAim(aimX) - W / 2) * 0.24
      : W / 2;
    if (!CHAR.x) { CHAR.x = W / 2; CHAR.prevX = W / 2; }
    CHAR.prevX = CHAR.x;
    CHAR.x += (targetX - CHAR.x) * 0.16;
    CHAR.vx = CHAR.x - CHAR.prevX;

    const targetTilt = clamp((CHAR.x - W / 2) / 40 + CHAR.vx * 0.08, -0.28, 0.28);
    CHAR.tilt += (targetTilt - CHAR.tilt) * 0.18;

    const baseY = TUBE_TOP * 0.48;
    const bob = dancing ? Math.sin(now / 110) * 4.5 : Math.sin(now / 500) * 2.8;

    // Timers
    if (CHAR.throwT > 0) CHAR.throwT = Math.max(0, CHAR.throwT - 0.08);
    if (CHAR.petT > 0) CHAR.petT = Math.max(0, CHAR.petT - 0.045);
    if (CHAR.cheerT > 0) CHAR.cheerT = Math.max(0, CHAR.cheerT - 0.045);
    if (CHAR.flipT > 0) CHAR.flipT = Math.max(0, CHAR.flipT - 0.04);

    const petHop = CHAR.petT > 0 ? Math.sin(CHAR.petT * Math.PI) * 8 : 0;
    const cheerHop = CHAR.cheerT > 0 ? Math.sin(CHAR.cheerT * Math.PI) * 5 : 0;

    CHAR.cx = CHAR.x;
    CHAR.cy = baseY + bob - petHop - cheerHop;

    const happy = dancing || CHAR.petT > 0 || CHAR.cheerT > 0;
    const worried = dangerProximity > 0.45 && !dancing;
    const aiming = pointerDown && currentBall && !dancing;

    // Current ball color for tractor beam & resonance
    let ballColor = '#4deeea';
    if (currentBall && !currentBall.label) {
      const lv = LEVELS[currentBall.level];
      if (lv) ballColor = lv.color;
    } else if (nextSpawn && LEVELS[nextSpawn.level]) {
      ballColor = LEVELS[nextSpawn.level].color;
    }

    const aimTargetX = (currentBall && currentBall.isFalling) || pointerDown ? clampAim(aimX) : W / 2;
    const lookX = clamp((aimTargetX - CHAR.cx) / (W * 0.35), -1, 1) * 2.5;
    const lookY = pointerDown ? 1.6 : 0.4;

    // Render Masterpiece Astral Sovereign
    drawAstralArchon(ctx, {
      mascot: currentMascot,
      cx: CHAR.cx,
      cy: CHAR.cy,
      scale: 1.05,
      tilt: CHAR.tilt,
      flipProgress: CHAR.flipT,
      now,
      house: currentHouse,
      skin: equippedSkin,
      lookX,
      lookY,
      aiming,
      happy,
      worried,
      ballColor,
      showScepter: true
    });

    // TRACTOR BEAM: When aiming, dual helical energy beams link staff & hand to dropping ball!
    if (aiming && currentBall) {
      ctx.save();
      const ballPos = currentBall.position;
      const scepX = CHAR.cx + 28;
      const scepY = CHAR.cy + 4;
      const handLX = CHAR.cx - 21;
      const handLY = CHAR.cy + 7;

      // Staff Focus Beam (Helical Starlight Wave)
      ctx.beginPath();
      ctx.moveTo(scepX, scepY);
      const steps = 16;
      for (let s = 1; s <= steps; s++) {
        const tVal = s / steps;
        const curX = scepX + (ballPos.x - scepX) * tVal;
        const curY = scepY + (ballPos.y - scepY) * tVal;
        const waveOffset = Math.sin(now * 0.015 + tVal * 8) * (1 - tVal) * 8;
        ctx.lineTo(curX + waveOffset, curY);
      }
      ctx.strokeStyle = ballColor;
      ctx.lineWidth = 2.4;
      ctx.shadowColor = ballColor;
      ctx.shadowBlur = 12;
      ctx.stroke();

      // Hand Resonance Beam
      ctx.beginPath();
      ctx.moveTo(handLX, handLY);
      ctx.quadraticCurveTo(
        (handLX + ballPos.x) / 2 - 10,
        (handLY + ballPos.y) / 2,
        ballPos.x - currentBall.circleRadius * 0.3,
        ballPos.y + currentBall.circleRadius * 0.6
      );
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 1.6;
      ctx.shadowColor = '#ffd23f';
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // SPARKS & RUNIC BURST
    for (let i = CHAR.sparks.length - 1; i >= 0; i--) {
      const p = CHAR.sparks[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.025;
      p.life -= 0.024;
      if (p.life <= 0) {
        CHAR.sparks.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.font = '15px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      ctx.fillText(p.char, CHAR.cx + p.x, CHAR.cy + p.y);
      ctx.restore();
    }

    // Gilded Celestial Archon Speech Scroll Banner
    if (CHAR.speechUntil > now && CHAR.speechText) {
      const bubbleT = (CHAR.speechUntil - now) / 1900;
      const alpha = Math.min(1, bubbleT * 2.2);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = 'bold 12px "Cinzel", "Times New Roman", serif, sans-serif';
      const textWidth = ctx.measureText(CHAR.speechText).width;
      const boxW = Math.max(160, textWidth + 30);
      const boxH = 28;
      const bx = CHAR.cx;
      const by = CHAR.cy - 56;

      ctx.shadowColor = '#ffd23f';
      ctx.shadowBlur = 14;

      // Royal Sapphire to Midnight Velvet Gradient
      const sbg = ctx.createLinearGradient(bx - boxW / 2, by - boxH / 2, bx + boxW / 2, by + boxH / 2);
      sbg.addColorStop(0, 'rgba(8, 14, 38, 0.96)');
      sbg.addColorStop(0.5, 'rgba(20, 34, 84, 0.98)');
      sbg.addColorStop(1, 'rgba(6, 10, 28, 0.96)');
      ctx.fillStyle = sbg;
      ctx.beginPath();
      ctx.roundRect(bx - boxW / 2, by - boxH / 2, boxW, boxH, 6);
      ctx.fill();

      // Ornate Gold Filigree Border
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Corner Gold Sigils
      const cw = 4;
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(bx - boxW / 2 + 2, by - boxH / 2 + 2, cw, cw);
      ctx.fillRect(bx + boxW / 2 - 2 - cw, by - boxH / 2 + 2, cw, cw);
      ctx.fillRect(bx - boxW / 2 + 2, by + boxH / 2 - 2 - cw, cw, cw);
      ctx.fillRect(bx + boxW / 2 - 2 - cw, by + boxH / 2 - 2 - cw, cw, cw);

      // Downward pointer
      ctx.beginPath();
      ctx.moveTo(bx - 6, by + boxH / 2);
      ctx.lineTo(bx, by + boxH / 2 + 7);
      ctx.lineTo(bx + 6, by + boxH / 2);
      ctx.closePath();
      ctx.fillStyle = '#ffd23f';
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(CHAR.speechText, bx, by);
      ctx.restore();
    }
  }

  // --- Background & Ambience (Stardust & Nebula Particle System) ---
  const stars = [];
  const nebulaClouds = [];
  const stardustParticles = [];
  const ambientParticles = [];
  let currentStarColorRGB = '180,200,255';
  let currentAmbient = 'nebula';
  let hasAuroraWaves = false;
  let currentLocIdx = 0;
  let auroraWaveTime = 0;

  const THEME_PARTICLE_PALETTES = [
    {
      // Neon Cosmos
      nebula: ['77,238,234', '176,38,255', '255,61,154', '56,189,248', '139,92,246'],
      stardust: ['180,220,255', '255,210,63', '255,150,220', '130,240,255', '240,246,255']
    },
    {
      // Coral Reef
      nebula: ['20,184,166', '45,212,191', '6,182,212', '14,116,144', '45,212,191'],
      stardust: ['140,255,230', '165,243,252', '94,234,212', '204,251,241', '255,255,255']
    },
    {
      // Candy Kingdom
      nebula: ['244,114,182', '192,132,252', '251,146,60', '236,72,153', '244,114,182'],
      stardust: ['255,190,230', '254,215,170', '249,168,212', '253,230,138', '255,255,255']
    },
    {
      // Aurora Borealis
      nebula: ['52,211,153', '45,212,191', '56,189,248', '167,243,208', '52,211,153'],
      stardust: ['170,255,210', '186,230,253', '153,246,228', '207,250,254', '255,255,255']
    },
    {
      // Pulsar Forge
      nebula: ['245,158,11', '239,68,68', '249,115,22', '217,119,6', '252,211,77'],
      stardust: ['255,185,90', '254,215,170', '253,186,116', '255,237,213', '255,255,255']
    }
  ];

  function initStars() {
    stars.length = 0;
    const count = Math.floor((W * H) / 9000);
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * W, y: Math.random() * H,
        r: 0.6 + Math.random() * 1.4,
        phase: Math.random() * Math.PI * 2,
        speed: 0.02 + Math.random() * 0.03
      });
    }
  }

  function initBackgroundParticles() {
    nebulaClouds.length = 0;
    stardustParticles.length = 0;
    if (!W || !H) return;

    const palette = THEME_PARTICLE_PALETTES[currentLocIdx] || THEME_PARTICLE_PALETTES[0];

    // 1. Nebula clouds: 5 expansive, soft, slowly breathing volumetric gas pockets
    const cloudCount = 5;
    for (let i = 0; i < cloudCount; i++) {
      const color = palette.nebula[i % palette.nebula.length];
      const baseRadius = Math.min(W, H) * (0.34 + Math.random() * 0.22);
      nebulaClouds.push({
        x: Math.random() * W,
        y: Math.random() * H,
        baseRadius,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.09,
        color,
        alpha: 0.042 + Math.random() * 0.035, // Subtle, soft ambient glow
        pulsePhase: Math.random() * Math.PI * 2,
        pulseSpeed: 0.003 + Math.random() * 0.006
      });
    }

    // 2. Stardust particles: weightless floating particles with gentle drift and shimmer
    const dustCount = Math.max(32, Math.min(56, Math.floor((W * H) / 7200)));
    for (let i = 0; i < dustCount; i++) {
      const color = palette.stardust[Math.floor(Math.random() * palette.stardust.length)];
      stardustParticles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 0.75 + Math.random() * 1.6,
        vx: (Math.random() - 0.5) * 0.15,
        vy: -0.14 - Math.random() * 0.26, // gentle upward cosmic flotation
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.012 + Math.random() * 0.02,
        wobbleAmp: 0.25 + Math.random() * 0.45,
        twinklePhase: Math.random() * Math.PI * 2,
        twinkleSpeed: 0.018 + Math.random() * 0.032,
        baseAlpha: 0.22 + Math.random() * 0.48,
        color,
        sparkle: Math.random() < 0.24
      });
    }
  }

  function initAmbient() {
    initBackgroundParticles();
    ambientParticles.length = 0;
    if (!W || !H || currentAmbient === 'nebula') return;
    const count = Math.max(12, Math.floor((W * H) / 16000));
    for (let i = 0; i < count; i++) {
      ambientParticles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: currentAmbient === 'embers' ? (1.5 + Math.random() * 2.5) : (2 + Math.random() * 4),
        speed: currentAmbient === 'embers' ? (0.6 + Math.random() * 1.2) : (0.3 + Math.random() * 0.6),
        wobble: Math.random() * Math.PI * 2,
        color: currentAmbient === 'embers' ? (Math.random() > 0.5 ? '#f59e0b' : '#ef4444') :
               currentAmbient === 'bubbles' ? '#2dd4bf' :
               currentAmbient === 'snow' ? '#a7f3d0' : '#ff6fb0'
      });
    }
  }

  function applyTheme(locIdx) {
    const loc = LOCATIONS[locIdx] || LOCATIONS[0];
    canvas.style.background = loc.bgTube;
    document.documentElement.style.setProperty('--bg-glow', loc.pageGlow);
    currentStarColorRGB = loc.starColor;
    currentAmbient = loc.ambient || 'nebula';
    hasAuroraWaves = !!loc.waves;
    currentLocIdx = locIdx;
    initAmbient();

    if (loc.id === 'reef') { locGravityMult = 0.84; locRestitutionMult = 1.1; locFloorFriction = 0.92; }
    else if (loc.id === 'candy') { locGravityMult = 1.0; locRestitutionMult = 1.3; locFloorFriction = 0.90; }
    else if (loc.id === 'aurora') { locGravityMult = 1.0; locRestitutionMult = 1.0; locFloorFriction = 0.98; }
    else if (loc.id === 'forge') { locGravityMult = 1.08; locRestitutionMult = 1.18; locFloorFriction = 0.94; }
    else { locGravityMult = 1.0; locRestitutionMult = 1.0; locFloorFriction = 0.92; }
  }

  // --- Trajectory & Ghost Ball Prediction ---
  function computeAimLanding(ball) {
    let targetY = H - ball.circleRadius;
    let hitBall = null;
    for (const b of balls) {
      if (b === ball || b.position.y <= ball.position.y) continue;
      const dx = b.position.x - ball.position.x;
      const sumR = b.circleRadius + ball.circleRadius;
      if (Math.abs(dx) < sumR) {
        const dySq = sumR * sumR - dx * dx;
        if (dySq >= 0) {
          const collideY = b.position.y - Math.sqrt(dySq);
          if (collideY < targetY) {
            targetY = collideY;
            hitBall = b;
          }
        }
      }
    }
    return { y: Math.max(targetY, ball.position.y), hitBall };
  }

  function drawBackground() {
    // 1. Nebula clouds: Soft volumetric luminous gas clouds drifting across space
    for (let i = 0; i < nebulaClouds.length; i++) {
      const c = nebulaClouds[i];
      c.x += c.vx;
      c.y += c.vy;
      c.pulsePhase += c.pulseSpeed;

      const margin = c.baseRadius * 1.2;
      if (c.x < -margin) c.x = W + margin;
      else if (c.x > W + margin) c.x = -margin;
      if (c.y < -margin) c.y = H + margin;
      else if (c.y > H + margin) c.y = -margin;

      const currentRadius = c.baseRadius * (1 + 0.14 * Math.sin(c.pulsePhase));
      const currentAlpha = c.alpha * (0.82 + 0.22 * Math.sin(c.pulsePhase * 0.75));

      const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, currentRadius);
      grad.addColorStop(0, `rgba(${c.color},${currentAlpha.toFixed(3)})`);
      grad.addColorStop(0.48, `rgba(${c.color},${(currentAlpha * 0.38).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${c.color},0)`);

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(c.x, c.y, currentRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. Aurora Waves (undulating polar electromagnetic ribbons for aurora biome)
    if (hasAuroraWaves) {
      auroraWaveTime += 0.009;
      ctx.save();
      const waveGrad = ctx.createLinearGradient(0, H * 0.1, 0, H * 0.6);
      waveGrad.addColorStop(0, 'rgba(77,238,234,0)');
      waveGrad.addColorStop(0.4, 'rgba(52,211,153,0.055)');
      waveGrad.addColorStop(0.8, 'rgba(45,212,191,0.025)');
      waveGrad.addColorStop(1, 'rgba(45,212,191,0)');
      ctx.fillStyle = waveGrad;

      ctx.beginPath();
      ctx.moveTo(0, H * 0.22 + Math.sin(auroraWaveTime) * 14);
      for (let x = 0; x <= W; x += 18) {
        const y = H * 0.25 + Math.sin(auroraWaveTime + x * 0.014) * 16 + Math.cos(auroraWaveTime * 0.6 + x * 0.022) * 10;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H * 0.6);
      ctx.lineTo(0, H * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // 3. Distant Stars Field
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      s.phase += s.speed;
      const a = 0.22 + 0.38 * (0.5 + 0.5 * Math.sin(s.phase));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${currentStarColorRGB},${a.toFixed(2)})`;
      ctx.fill();
    }

    // 4. Stardust Particles: Floating cosmic motes with gentle sinusoidal drift and luminescence
    for (let i = 0; i < stardustParticles.length; i++) {
      const p = stardustParticles[i];
      p.wobble += p.wobbleSpeed;
      p.x += p.vx + Math.sin(p.wobble) * p.wobbleAmp;
      p.y += p.vy;
      p.twinklePhase += p.twinkleSpeed;

      // Wrap around bounds with gentle randomized re-entry
      if (p.y < -12) {
        p.y = H + 10;
        p.x = Math.random() * W;
      } else if (p.y > H + 12) {
        p.y = -10;
        p.x = Math.random() * W;
      }
      if (p.x < -12) p.x = W + 10;
      else if (p.x > W + 12) p.x = -10;

      const twinkle = 0.5 + 0.5 * Math.sin(p.twinklePhase);
      const alpha = p.baseAlpha * (0.42 + 0.58 * twinkle);

      // Subtle soft glow halo
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 2.4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.color},${(alpha * 0.24).toFixed(3)})`;
      ctx.fill();

      // Sharp luminous stardust core
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.color},${alpha.toFixed(2)})`;
      ctx.fill();

      // Delicate 4-point micro-sparkle cross flare when twinkling brightly
      if (p.sparkle && twinkle > 0.84) {
        const flareAlpha = (twinkle - 0.84) * 3.8 * alpha;
        const flareLen = p.r * 3.4;
        ctx.strokeStyle = `rgba(255,255,255,${flareAlpha.toFixed(2)})`;
        ctx.lineWidth = 0.75;
        ctx.beginPath();
        ctx.moveTo(p.x - flareLen, p.y);
        ctx.lineTo(p.x + flareLen, p.y);
        ctx.moveTo(p.x, p.y - flareLen);
        ctx.lineTo(p.x, p.y + flareLen);
        ctx.stroke();
      }
    }

    // 5. Ambient World Particles (Embers, Bubbles, Snow, Confetti)
    if (currentAmbient !== 'nebula' && ambientParticles.length > 0) {
      for (let i = 0; i < ambientParticles.length; i++) {
        const ap = ambientParticles[i];
        ap.wobble += 0.035;
        if (currentAmbient === 'embers') {
          // Fiery plasma embers float upwards
          ap.y -= ap.speed * 1.5;
          ap.x += Math.sin(ap.wobble) * 0.9;
          if (ap.y < -12) { ap.y = H + 12; ap.x = Math.random() * W; }
          ctx.beginPath();
          ctx.arc(ap.x, ap.y, ap.r, 0, Math.PI * 2);
          ctx.fillStyle = ap.color;
          ctx.globalAlpha = 0.5 + Math.sin(ap.wobble * 2) * 0.3;
          ctx.fill();
          ctx.globalAlpha = 1.0;
        } else if (currentAmbient === 'bubbles') {
          ap.y -= ap.speed * 0.9;
          ap.x += Math.sin(ap.wobble) * 0.5;
          if (ap.y < -12) { ap.y = H + 12; ap.x = Math.random() * W; }
          ctx.beginPath();
          ctx.arc(ap.x, ap.y, ap.r, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(45,212,191,0.5)';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        } else if (currentAmbient === 'snow') {
          ap.y += ap.speed * 0.85;
          ap.x += Math.sin(ap.wobble) * 0.6;
          if (ap.y > H + 12) { ap.y = -12; ap.x = Math.random() * W; }
          ctx.beginPath();
          ctx.arc(ap.x, ap.y, ap.r * 0.7, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(167,243,208,0.6)';
          ctx.fill();
        } else if (currentAmbient === 'confetti') {
          ap.y += ap.speed * 0.75;
          ap.x += Math.sin(ap.wobble) * 0.5;
          if (ap.y > H + 12) { ap.y = -12; ap.x = Math.random() * W; }
          ctx.save();
          ctx.translate(ap.x, ap.y);
          ctx.rotate(ap.wobble);
          ctx.fillStyle = ap.color;
          ctx.globalAlpha = 0.65;
          ctx.fillRect(-ap.r, -ap.r * 0.5, ap.r * 2, ap.r);
          ctx.restore();
        }
      }
    }
  }

  // --- Main Drawing Loop ---
  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (shakeAmount > 0.05) {
      const sx = (Math.random() - 0.5) * shakeAmount;
      const sy = (Math.random() - 0.5) * shakeAmount;
      ctx.translate(sx, sy);
      shakeAmount *= 0.86;
    }

    // Ambient Stardust, Nebula & Stars
    drawBackground();

    // Danger red glow at the top & Peripheral Danger Vignette
    if (dangerProximity > 0.01) {
      const grad = ctx.createLinearGradient(0, 0, 0, dangerY);
      grad.addColorStop(0, `rgba(255,61,154,${(dangerProximity * 0.18).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255,61,154,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, dangerY);
    }
    if (dangerTimer > 18) {
      const effectiveDangerLimit = currentHouse === 'chrono' ? Math.round(DANGER_LIMIT * 1.2) : DANGER_LIMIT;
      const dangerRatio = Math.min(1, Math.max(0, (dangerTimer - 18) / (effectiveDangerLimit - 18)));
      const pulse = (Math.sin(performance.now() * (0.008 + dangerRatio * 0.014)) + 1) * 0.5;
      const vigGrad = ctx.createRadialGradient(W / 2, H / 2, W * 0.32, W / 2, H / 2, W * 0.72);
      vigGrad.addColorStop(0, 'rgba(255, 30, 80, 0)');
      vigGrad.addColorStop(1, `rgba(255, 30, 80, ${(0.12 + dangerRatio * 0.28) * pulse})`);
      ctx.fillStyle = vigGrad;
      ctx.fillRect(0, 0, W, H);
    }

    // Balls rendering
    for (const b of balls) {
      const isWild = b.label === 'wildcard';
      const lv = isWild ? null : LEVELS[b.gameLevel];
      const { x, y } = b.position;
      let scale = 1;
      if (b.spawnAt) {
        const t = Math.min(1, (performance.now() - b.spawnAt) / 180);
        scale = 0.6 + 0.4 * t;
      }

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(b.angle);
      ctx.scale(scale, scale);

      ctx.beginPath();
      ctx.arc(0, 0, b.circleRadius, 0, Math.PI * 2);
      if (isWild) {
        ctx.fillStyle = '#ff3d9a';
        ctx.shadowColor = '#ffd23f';
        ctx.shadowBlur = 16;
      } else {
        const rg = ctx.createRadialGradient(-b.circleRadius * 0.35, -b.circleRadius * 0.4, b.circleRadius * 0.15, 0, 0, b.circleRadius);
        rg.addColorStop(0, '#ffffff');
        rg.addColorStop(0.35, lv.color);
        rg.addColorStop(1, '#060a1f');
        ctx.fillStyle = rg;
        ctx.shadowColor = lv.glow;
        ctx.shadowBlur = 12;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.stroke();

      ctx.fillStyle = isWild ? '#ffffff' : '#04122a';
      ctx.font = `900 ${Math.max(11, b.circleRadius * 0.55)}px 'Baloo 2', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isWild ? '✦' : lv.label, 0, 1);
      ctx.restore();
    }

    // Predictive Trajectory, Ghost Ball & Magnetic Merge Link Glow
    if (currentBall && currentBall.isFalling && (pointerDown || gestureOnCanvas) && !gameOver) {
      const startY = currentBall.position.y + currentBall.circleRadius + 2;
      const { y: endY, hitBall } = computeAimLanding(currentBall);
      const isWild = currentBall.label === 'wildcard';
      const lv = !isWild && LEVELS[currentBall.gameLevel] ? LEVELS[currentBall.gameLevel] : LEVELS[0];
      const willMerge = hitBall && (hitBall.gameLevel === currentBall.gameLevel || isWild || hitBall.label === 'wildcard');

      if (endY > startY) {
        const now = performance.now();
        const pulse = (Math.sin(now * 0.008) + 1) * 0.5;

        // 1. Dashed neon laser trajectory line
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([6, 6]);
        ctx.lineDashOffset = -now * 0.035;
        ctx.moveTo(currentBall.position.x, startY);
        ctx.lineTo(currentBall.position.x, endY - currentBall.circleRadius);
        ctx.strokeStyle = willMerge ? 'rgba(255, 210, 63, 0.75)' : 'rgba(77, 238, 234, 0.55)';
        ctx.lineWidth = willMerge ? 2.8 : 2.0;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // 2. Ground landing footprint if landing on the tube floor
        if (!hitBall) {
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(currentBall.position.x, H - 4, currentBall.circleRadius * 0.75, 4, 0, 0, Math.PI * 2);
          ctx.fillStyle = willMerge ? 'rgba(255, 210, 63, 0.35)' : 'rgba(77, 238, 234, 0.25)';
          ctx.fill();
          ctx.restore();
        }

        // 3. Ghost Ball 3D volumetric preview
        ctx.save();
        const r = currentBall.circleRadius;
        const gx = currentBall.position.x;
        const gy = endY;

        // Outer pulsing ring
        ctx.beginPath();
        ctx.arc(gx, gy, r + 3 + pulse * 3.5, 0, Math.PI * 2);
        ctx.strokeStyle = willMerge ? `rgba(255, 210, 63, ${0.3 + pulse * 0.35})` : `rgba(77, 238, 234, ${0.18 + pulse * 0.22})`;
        ctx.lineWidth = 1.8;
        ctx.stroke();

        // Ball volume preview
        ctx.beginPath();
        ctx.arc(gx, gy, r, 0, Math.PI * 2);
        const grad = ctx.createRadialGradient(gx - r * 0.35, gy - r * 0.35, r * 0.1, gx, gy, r);
        if (willMerge) {
          grad.addColorStop(0, 'rgba(255, 245, 180, 0.7)');
          grad.addColorStop(0.6, 'rgba(255, 210, 63, 0.42)');
          grad.addColorStop(1, 'rgba(230, 130, 20, 0.22)');
        } else {
          grad.addColorStop(0, 'rgba(255, 255, 255, 0.48)');
          grad.addColorStop(0.65, (lv.color || '#4deeea') + '38');
          grad.addColorStop(1, (lv.color || '#4deeea') + '15');
        }
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.strokeStyle = willMerge ? '#ffd23f' : (lv.color || 'rgba(255,255,255,0.7)');
        ctx.lineWidth = willMerge ? 2.5 : 1.8;
        ctx.stroke();

        // Level label inside ghost ball
        ctx.fillStyle = willMerge ? '#ffffff' : 'rgba(255, 255, 255, 0.9)';
        ctx.font = `900 ${Math.max(10, r * 0.52)}px 'Baloo 2', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(isWild ? '✦' : lv.label, gx, gy);

        // 4. Magnetic merge link and badge
        if (willMerge && hitBall) {
          ctx.beginPath();
          ctx.moveTo(gx, gy);
          ctx.lineTo(hitBall.position.x, hitBall.position.y);
          ctx.strokeStyle = `rgba(255, 210, 63, ${0.75 + pulse * 0.25})`;
          ctx.lineWidth = 3;
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.setLineDash([]);

          // Merge badge above ghost ball
          ctx.font = "900 11px 'Baloo 2', sans-serif";
          const mergeText = currentLang === 'ru' ? '✦ СЛИЯНИЕ' : '✦ MERGE';
          const tw = ctx.measureText(mergeText).width;
          const tagY = gy - r - 10;
          ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
          ctx.beginPath();
          ctx.roundRect(gx - tw / 2 - 7, tagY - 8, tw + 14, 16, 8);
          ctx.fill();
          ctx.strokeStyle = '#ffd23f';
          ctx.lineWidth = 1.2;
          ctx.stroke();

          ctx.fillStyle = '#ffd23f';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(mergeText, gx, tagY);
        }
        ctx.restore();
      }
    }

    // Particles
    particles = particles.filter(p => p.life > 0);
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.life--;
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3 * alpha + 1, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Floating text scores
    floatingTexts = floatingTexts.filter(t => t.life > 0);
    for (const t of floatingTexts) {
      t.y -= 0.65; t.life--;
      const alpha = Math.max(0, t.life / t.maxLife);
      ctx.font = `900 ${t.size}px 'Baloo 2', sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = t.color;
      ctx.globalAlpha = alpha;
      ctx.fillText(t.text, t.x, t.y);
      ctx.globalAlpha = 1;
    }

    // --- Render Singularity & Black Holes ---
    activeSingularities = activeSingularities.filter(s => s.life > 0);
    for (const s of activeSingularities) {
      s.life--;
      s.rot += 0.055;
      const progress = 1 - s.life / s.maxLife;
      const curR = s.maxR * Math.sin(progress * Math.PI);
      const alpha = Math.min(1, s.life / 18);

      ctx.save();
      ctx.translate(s.x, s.y);

      // 1. Relativistic Accretion Glow
      const glowGrad = ctx.createRadialGradient(0, 0, curR * 0.1, 0, 0, curR * 1.6);
      glowGrad.addColorStop(0, 'rgba(0,0,0,0.95)');
      glowGrad.addColorStop(0.35, s.color);
      glowGrad.addColorStop(0.7, 'rgba(255, 210, 63, 0.35)');
      glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glowGrad;
      ctx.globalAlpha = alpha * 0.85;
      ctx.beginPath();
      ctx.arc(0, 0, curR * 1.6, 0, Math.PI * 2);
      ctx.fill();

      // 2. Accretion Swirling Stream Particles
      ctx.globalAlpha = alpha;
      for (const p of s.diskParticles) {
        p.angle += p.speed;
        p.dist = Math.max(curR * 0.28, p.dist - 0.3);
        const px = Math.cos(p.angle) * p.dist;
        const py = Math.sin(p.angle) * p.dist * 0.42;
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd23f';
        ctx.shadowColor = s.color;
        ctx.shadowBlur = 6;
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // 3. Gravitational Photon Ring
      ctx.beginPath();
      ctx.ellipse(0, 0, curR * 0.88, curR * 0.38, s.rot, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.2;
      ctx.shadowColor = s.color;
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // 4. The Event Horizon (Deep Obsidian Black Core)
      ctx.beginPath();
      ctx.arc(0, 0, curR * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = '#020308';
      ctx.fill();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = s.color;
      ctx.stroke();

      ctx.restore();
    }

    ctx.restore();
    drawCharacter();
  }

  // --- Danger Detection & Game Over ---
  function checkDanger() {
    if (gameOver || !running) return;
    if (rescueGraceTimer > 0) {
      dangerTimer = 0;
      dangerProximity = 0;
      dangerLineEl.style.opacity = '0';
      dangerLineEl.classList.remove('danger-critical');
      return;
    }
    const bodies = balls.filter(b => b !== currentBall);
    let inDanger = false;
    let closestGap = Infinity;
    const now = performance.now();

    for (const b of bodies) {
      if (!b.settleRefPos || now - b.settleRefTime > 220) {
        if (b.settleRefPos) {
          const dx = b.position.x - b.settleRefPos.x;
          const dy = b.position.y - b.settleRefPos.y;
          b.isSettled = Math.sqrt(dx * dx + dy * dy) < 12;
        }
        b.settleRefPos = { x: b.position.x, y: b.position.y };
        b.settleRefTime = now;
      }
      const age = b.spawnAt ? now - b.spawnAt : 9999;
      if (age <= 280 || !b.isSettled) continue;

      const topEdge = b.position.y - b.circleRadius;
      const gap = topEdge - dangerY;
      if (gap < closestGap) closestGap = gap;
      if (topEdge < dangerY) inDanger = true;
    }

    if (closestGap === Infinity) closestGap = 120;
    dangerProximity = clamp(1 - closestGap / 120, 0, 1);

    const effectiveDangerLimit = currentHouse === 'chrono' ? Math.round(DANGER_LIMIT * 1.2) : DANGER_LIMIT;

    if (inDanger) {
      dangerTimer++;
      if (dangerTimer > effectiveDangerLimit * 0.3) {
        const dangerRatio = (dangerTimer - effectiveDangerLimit * 0.3) / (effectiveDangerLimit * 0.7);
        const beatInterval = 820 - dangerRatio * 440; // 820ms down to 380ms
        if (now - lastDangerBeatTime > beatInterval) {
          lastDangerBeatTime = now;
          AudioManager.playDangerHeartbeat(dangerRatio);
          triggerHaptic([18, 12, 22]);
        }
        // Micro sparks along danger line
        if (Math.random() < 0.3) {
          particles.push({
            x: W * 0.15 + Math.random() * (W * 0.7),
            y: dangerY + (Math.random() - 0.5) * 4,
            vx: (Math.random() - 0.5) * 2,
            vy: -1 - Math.random() * 2,
            life: 18, maxLife: 18,
            color: Math.random() > 0.5 ? '#ff3d9a' : '#ffd23f'
          });
        }
      }
      if (dangerTimer > effectiveDangerLimit) triggerGameOver();
    } else {
      dangerTimer = Math.max(0, dangerTimer - 1);
    }

    dangerLineEl.style.opacity = Math.max(dangerProximity, dangerTimer > 0 ? 0.7 : 0).toFixed(2);
    dangerLineEl.classList.toggle('danger-critical', dangerTimer > effectiveDangerLimit * 0.5);
  }

  function triggerGameOver() {
    if (canRescueThisRun && !goalAchieved && balls.length > 2) {
      startEmergencyRescue();
      return;
    }
    gameOver = true;
    running = false;
    try { ysdk?.features?.GameplayAPI?.stop?.(); } catch(e){}
    selectedTool = null;
    updateToolButtons();
    clearLevelSave();
    clearEndlessSave();
    showGameOver();
  }

  // --- Modal State Detection ---
  function isModalActive() {
    const ov = document.getElementById('overlay');
    if (ov && ov.classList.contains('show')) return true;
    if (document.body.classList.contains('in-menu')) return true;
    const activeModal = document.querySelector(
      '.cosmic-modal-wrap.show-modal, .cosmic-modal-wrap.show, .master-overlay.show, .master-overlay.show-modal, .master-overlay.show-select'
    );
    return !!activeModal;
  }

  // --- Input Handlers (Touch & Pointer Events) ---
  let pointerDown = false;
  let gestureOnCanvas = false;
  let activeTouchId = null;

  function handleStart(cx, cy) {
    if (isModalActive()) {
      pointerDown = false;
      gestureOnCanvas = false;
      return;
    }
    // Mascot tap interaction (Petting Mergik - only within upper mascot zone)
    if (CHAR.cx && CHAR.cy && cy != null && cy <= (TUBE_TOP + 8)) {
      const dist = Math.hypot(cx - CHAR.cx, cy - CHAR.cy);
      if (dist < 28) {
        triggerCharPet();
        return;
      }
    }
    gestureOnCanvas = true;
    if (selectedTool) return;
    pointerDown = true;
    aimX = cx;
    const clampedAimX = clampAim(aimX);
    if (currentBall && currentBall.isFalling) {
      currentBall.position.x = clampedAimX;
    }
    if (typeof CHAR === 'object' && CHAR !== null) {
      const targetCharX = W / 2 + (clampedAimX - W / 2) * 0.24;
      CHAR.targetX = targetCharX;
      CHAR.x += (targetCharX - CHAR.x) * 0.3;
      CHAR.cx = CHAR.x;
    }
  }

  function handleMove(cx, cy) {
    if (isModalActive()) {
      pointerDown = false;
      gestureOnCanvas = false;
      return;
    }
    if (selectedTool) return;
    aimX = cx;
    const clampedAimX = clampAim(aimX);
    if (currentBall && currentBall.isFalling) {
      currentBall.position.x = clampedAimX;
    }
    // Ensure character position tracks smoothly and accurately even if touch point drifts outside bounds
    if (typeof CHAR === 'object' && CHAR !== null) {
      const targetCharX = W / 2 + (clampedAimX - W / 2) * 0.24;
      CHAR.targetX = targetCharX;
      if (!CHAR.x) CHAR.x = targetCharX;
      CHAR.x += (targetCharX - CHAR.x) * 0.28;
      CHAR.cx = CHAR.x;
    }
  }

  function handleEnd(cx, cy) {
    if (isModalActive()) {
      pointerDown = false;
      gestureOnCanvas = false;
      return;
    }
    if (!gestureOnCanvas && !pointerDown) return;
    gestureOnCanvas = false;
    const wasDown = pointerDown;
    pointerDown = false;
    if (selectedTool) {
      if (cx != null && cy != null) resolveToolTap(cx, cy);
      return;
    }
    if (!wasDown) return;
    if (gameOver) return;
    if (currentBall) {
      dropCurrent();
    } else if (running && !spawnTimeoutId && !goalAchieved) {
      spawnCurrent();
    }
  }

  function getCanvasCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (W / rect.width),
      y: (clientY - rect.top) * (H / rect.height)
    };
  }

  // --- Dedicated Touch Event Listeners (Primary on touch devices) ---
  function onTouchStart(e) {
    if (isModalActive()) {
      pointerDown = false;
      gestureOnCanvas = false;
      activeTouchId = null;
      return;
    }
    if (e.changedTouches && e.changedTouches.length > 0) {
      if (activeTouchId === null) {
        const t = e.changedTouches[0];
        activeTouchId = t.identifier;
        if (e.cancelable) e.preventDefault();
        const c = getCanvasCoords(t.clientX, t.clientY);
        handleStart(c.x, c.y);
      }
    }
  }

  function onTouchMove(e) {
    if (isModalActive()) {
      if (pointerDown || gestureOnCanvas) {
        pointerDown = false;
        gestureOnCanvas = false;
        activeTouchId = null;
      }
      return;
    }
    if (!pointerDown && !gestureOnCanvas) return;

    let touch = null;
    if (e.touches) {
      if (activeTouchId !== null) {
        for (let i = 0; i < e.touches.length; i++) {
          if (e.touches[i].identifier === activeTouchId) {
            touch = e.touches[i];
            break;
          }
        }
      }
      if (!touch && e.touches.length > 0) {
        touch = e.touches[0];
        activeTouchId = touch.identifier;
      }
    }
    if (!touch) return;
    if (e.cancelable) e.preventDefault();
    const c = getCanvasCoords(touch.clientX, touch.clientY);
    handleMove(c.x, c.y);
  }

  function onTouchEnd(e) {
    if (isModalActive()) {
      pointerDown = false;
      gestureOnCanvas = false;
      activeTouchId = null;
      return;
    }
    let touch = null;
    if (e.changedTouches) {
      if (activeTouchId !== null) {
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === activeTouchId) {
            touch = e.changedTouches[i];
            break;
          }
        }
      }
      if (!touch && e.changedTouches.length > 0) {
        touch = e.changedTouches[0];
      }
    }
    activeTouchId = null;
    const c = touch ? getCanvasCoords(touch.clientX, touch.clientY) : { x: null, y: null };
    handleEnd(c.x, c.y);
  }

  function onTouchCancel() {
    activeTouchId = null;
    handleEnd(null, null);
  }

  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd, { passive: false });
  window.addEventListener('touchcancel', onTouchCancel, { passive: false });

  // --- Pointer & Mouse Event Listeners (Desktop mouse & stylus) ---
  if (window.PointerEvent) {
    canvas.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') return; // Managed via dedicated TouchEvents
      if (e.button !== 0) return;
      if (isModalActive()) return;
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch(_){}
      const c = getCanvasCoords(e.clientX, e.clientY);
      handleStart(c.x, c.y);
    });

    const onPointerMove = e => {
      if (e.pointerType === 'touch') return;
      if (isModalActive()) {
        if (pointerDown || gestureOnCanvas) {
          pointerDown = false;
          gestureOnCanvas = false;
        }
        return;
      }
      if (pointerDown) {
        const c = getCanvasCoords(e.clientX, e.clientY);
        handleMove(c.x, c.y);
      }
    };
    canvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointermove', onPointerMove);

    const onPointerUp = e => {
      if (e.pointerType === 'touch') return;
      try {
        if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
      } catch(_){}
      if (isModalActive()) {
        pointerDown = false;
        gestureOnCanvas = false;
        return;
      }
      const c = getCanvasCoords(e.clientX, e.clientY);
      handleEnd(c.x, c.y);
    };
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', e => {
      if (e.pointerType === 'touch') return;
      handleEnd(null, null);
    });
  } else {
    canvas.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      if (isModalActive()) return;
      e.preventDefault();
      const c = getCanvasCoords(e.clientX, e.clientY);
      handleStart(c.x, c.y);
    });
    window.addEventListener('mousemove', e => {
      if (isModalActive()) {
        if (pointerDown || gestureOnCanvas) {
          pointerDown = false;
          gestureOnCanvas = false;
        }
        return;
      }
      if (pointerDown) {
        const c = getCanvasCoords(e.clientX, e.clientY);
        handleMove(c.x, c.y);
      }
    });
    window.addEventListener('mouseup', e => {
      if (isModalActive()) {
        pointerDown = false;
        gestureOnCanvas = false;
        return;
      }
      const c = getCanvasCoords(e.clientX, e.clientY);
      handleEnd(c.x, c.y);
    });
  }

  // --- Reliable Tap Binding Helper ---
  function bindTap(el, handler) {
    if (!el) return;
    let lastTouch = 0;
    let startX = 0;
    let startY = 0;
    let isScroll = false;

    el.addEventListener('touchstart', e => {
      if (e.touches && e.touches[0]) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        isScroll = false;
      }
    }, { passive: true });

    el.addEventListener('touchmove', e => {
      if (e.touches && e.touches[0]) {
        const dx = Math.abs(e.touches[0].clientX - startX);
        const dy = Math.abs(e.touches[0].clientY - startY);
        if (dx > 10 || dy > 10) isScroll = true;
      }
    }, { passive: true });

    el.addEventListener('touchend', e => {
      if (isScroll) return;
      e.preventDefault();
      lastTouch = Date.now();
      const isBackdrop = el.classList && (el.classList.contains('cosmic-modal-wrap') || el.classList.contains('master-overlay'));
      if (!isBackdrop) AudioManager.playButtonClick();
      handler(e);
    }, { passive: false });

    el.addEventListener('click', e => {
      if (Date.now() - lastTouch < 600) return;
      const isBackdrop = el.classList && (el.classList.contains('cosmic-modal-wrap') || el.classList.contains('master-overlay'));
      if (!isBackdrop) AudioManager.playButtonClick();
      handler(e);
    });
  }

  // --- Tools & Abilities ---
  let selectedTool = null;
  function toggleToolSelect(tool) {
    if (gameOver || !running) return;
    if ((inventory[tool] || 0) <= 0) return;
    selectedTool = selectedTool === tool ? null : tool;
    updateToolButtons();
  }
  function resolveToolTap(x, y) {
    const tool = selectedTool;
    selectedTool = null;
    updateToolButtons();
    if (!tool) return;

    let target = null, bestD = Infinity;
    for (const b of balls) {
      if (b === currentBall || b.isFalling || b.isStatic || !b.label.startsWith('ball_')) continue;
      const dx = b.position.x - x, dy = b.position.y - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= b.circleRadius && d < bestD) { bestD = d; target = b; }
    }
    if (!target) return;
    if ((inventory[tool] || 0) <= 0) return;

    inventory[tool]--;
    saveInventory();
    updateStarsUI();
    toolsUsedThisLevel++;

    if (tool === 'shrink') {
      if (target.gameLevel > 0) {
        const nLvl = target.gameLevel - 1;
        const nl = LEVELS[nLvl];
        const nb = makeBall(target.position.x, target.position.y, nl.r, nLvl);
        balls = balls.filter(x => x.id !== target.id);
        balls.push(nb);
        spawnMergeParticles(nb.position.x, nb.position.y, nl.color);
      }
    } else if (tool === 'bomb') {
      spawnMergeParticles(target.position.x, target.position.y, '#ff5f6d');
      balls = balls.filter(x => x.id !== target.id);
      shakeAmount = 10;
    }
  }

  function useSwap() {
    if (gameOver || !running || !currentBall || !currentBall.isStatic) return;
    if ((inventory.swap || 0) <= 0) return;
    inventory.swap--;
    saveInventory();
    updateStarsUI();
    toolsUsedThisLevel++;

    const curLvl = currentBall.gameLevel;
    const curWild = currentBall.label === 'wildcard';
    const newLvl = nextSpawn.wildcard ? -1 : nextSpawn.level;
    const newR = nextSpawn.wildcard ? LEVELS[0].r : LEVELS[nextSpawn.level].r;

    currentBall.gameLevel = newLvl;
    currentBall.circleRadius = newR;
    currentBall.mass = newR * newR;
    currentBall.label = nextSpawn.wildcard ? 'wildcard' : 'ball_' + newLvl;

    nextSpawn = { wildcard: curWild, level: curLvl };
    updateNextPreview();
  }

  function updateToolButtons() {
    ['shrink', 'bomb', 'swap'].forEach(name => {
      const btn = document.getElementById(name + 'Btn');
      if (btn) {
        const count = inventory[name] || 0;
        btn.disabled = count <= 0 || gameOver || !running;
        btn.classList.toggle('tool-selected', selectedTool === name);
        const costEl = btn.querySelector('.tool-cost');
        if (costEl) costEl.textContent = '×' + count;
      }
    });
  }

  // --- Game Loop ---
  let lastLoopTime = performance.now();
  function loop() {
    try {
      const now = performance.now();
      const dtSec = Math.min(0.1, (now - lastLoopTime) / 1000);
      lastLoopTime = now;

      if (running) {
        try {
          physicsStep();
          checkDanger();
        } catch(e){}
        if (comboTimer > 0) comboTimer--;
        else comboCount = 0;

        if (feverActive) {
          feverDuration = Math.max(0, feverDuration - dtSec);
          if (feverDuration <= 0) {
            deactivateFeverMode();
          } else {
            // Floating golden/pink stardust sparks during active fever
            if (Math.random() < 0.3) {
              const tubeLeft = TUBE_MARGIN + 20;
              const tubeRight = Math.max(tubeLeft + 10, W - TUBE_MARGIN - 20);
              particles.push({
                x: tubeLeft + Math.random() * (tubeRight - tubeLeft),
                y: H - 10,
                vx: (Math.random() - 0.5) * 1.5,
                vy: -2 - Math.random() * 3,
                life: 40,
                maxLife: 40,
                color: Math.random() > 0.4 ? '#ffd23f' : '#ff3d9a'
              });
            }
          }
          updateFeverUI();
        } else if (feverCharge > 0 && !gameOver) {
          // Subtle decay if player is taking too long between merges
          feverCharge = Math.max(0, feverCharge - dtSec * 1.8);
          updateFeverUI();
        }

        if (rescueGraceTimer > 0) {
          rescueGraceTimer = Math.max(0, rescueGraceTimer - dtSec);
        }

        if (nudgeTimer > 0) {
          nudgeTimer = Math.max(0, nudgeTimer - dtSec);
          updateNudgeUI();
        }

        // Failsafe recovery: auto-spawn current ball if missing and not pending
        if (!currentBall && !spawnTimeoutId && !gameOver && !goalAchieved) {
          spawnCurrent();
        }
      }
      updateMusicContext();
      try { draw(); } catch(e){}
    } catch(err) {
      console.error('Game loop error:', err);
    }
    requestAnimationFrame(loop);
  }

  // --- Save / Resume State ---
  function saveEndlessInProgress() {
    if (gameMode !== 'endless' || gameOver || balls.length === 0) return;
    const data = {
      score, mergesCount, highestLevel,
      balls: balls.filter(b => b !== currentBall).map(b => ({
        x: b.position.x, y: b.position.y, level: b.gameLevel, wildcard: b.label === 'wildcard'
      }))
    };
    safeStorage.setItem('mergeTowerEndlessSave', JSON.stringify(data));
    queueCloudSave();
  }
  function clearEndlessSave() { safeStorage.setItem('mergeTowerEndlessSave', ''); }
  function clearLevelSave() { safeStorage.setItem('mergeTowerLevelSave', ''); }

  // --- Modal System ---
  const overlay = document.getElementById('overlay');

  function resolveModalElement(id) {
    if (!id) return null;
    return document.getElementById(id)
      || document.getElementById(id.replace('Modal', 'Overlay'))
      || document.getElementById(id.replace('Overlay', 'Modal'))
      || (id === 'rulesModal' || id === 'helpModal' ? (document.getElementById('helpModal') || document.getElementById('rulesModal')) : null);
  }

  function openModal(id) {
    pointerDown = false;
    gestureOnCanvas = false;
    activeTouchId = null;
    playButtonTap();
    closeAllModals();
    const el = resolveModalElement(id);
    if (el) {
      el.classList.add('show-modal');
      el.classList.add('show-select');
      el.classList.add('show');
    }
  }

  function closeModal(id) {
    pointerDown = false;
    gestureOnCanvas = false;
    activeTouchId = null;
    playButtonTap();
    const el = resolveModalElement(id);
    if (el) {
      el.classList.remove('show-modal');
      el.classList.remove('show-select');
      el.classList.remove('show');
    }
  }

  function closeAllModals() {
    pointerDown = false;
    gestureOnCanvas = false;
    activeTouchId = null;
    document.querySelectorAll('.cosmic-modal-wrap, .master-overlay').forEach(m => {
      m.classList.remove('show-modal');
      m.classList.remove('show-select');
      m.classList.remove('show');
    });
  }

  function setGameViewMode(mode) {
    if (mode === 'menu') {
      document.body.classList.add('in-menu');
      selectedTool = null;
      if (typeof updateToolButtons === 'function') updateToolButtons();
      const badge = document.getElementById('houseActiveBadge');
      if (badge) badge.style.display = 'none';
    } else {
      document.body.classList.remove('in-menu');
      updateHouseActiveBadge();
    }
    updateStarsUI();
    try { sizeCanvas(); } catch(e) {}
  }

  function showMainMenu() {
    closeAllModals();
    running = false;
    gameOver = false;
    selectedTool = null;
    try { ysdk?.features?.GameplayAPI?.stop?.(); } catch(e){}
    overlay.classList.add('show');
    setGameViewMode('menu');
    updateScore();
    renderDifficultyRow();
    updateDailyBonusUI();
    renderMissions();
    renderTower();
    updateAchievementsBadge();
    updateMissionsBadge();
  }

  function startGame() {
    overlay.classList.remove('show');
    closeAllModals();
    setGameViewMode('game');
    resetBoard();
    running = true;
    canDrop = true;
    gameOver = false;
    goalAchieved = false;
    score = 0;
    updateScore();
    aimX = W / 2;
    spawnCurrent();
    try { startMusic(); } catch(e){}
    try { ysdk?.features?.GameplayAPI?.start?.(); } catch(e){}
    updateToolButtons();
    updateNudgeUI();
    updateGoalBanner();
    if (shouldShowTutorial()) startTutorial();
  }

  function resetBoard() {
    balls = [];
    particles = [];
    floatingTexts = [];
    dangerTimer = 0;
    dangerProximity = 0;
    lastDangerBeatTime = 0;
    currentBall = null;
    highestLevel = 0;
    comboCount = 0;
    mergesCount = 0;
    dropMergeChain = 0;
    lastDropMergeTime = 0;
    selectedTool = null;
    toolsUsedThisLevel = 0;
    newRecordThisRun = false;
    dangerLineEl.style.opacity = '0';
    dangerLineEl.classList.remove('danger-critical');
    canRescueThisRun = true;
    rescueGraceTimer = 0;
    feverCharge = 0;
    feverActive = false;
    feverDuration = 0;
    updateFeverUI();
  }

  function showGameOver() {
    gameOver = true;
    running = false;
    updateFeverUI();
    updateMissionsProgress(0, score, highestLevel);
    try { ysdk?.features?.GameplayAPI?.stop?.(); } catch(e){}
    AudioManager.playGameOver();
    submitYandexLeaderboard(score);

    const inPath = gameMode === 'path' && currentPathLevel >= 0;
    const isDaily = gameMode === 'daily';

    const scoreEl = document.getElementById('goScoreVal');
    if (scoreEl) scoreEl.textContent = score;
    const bestEl = document.getElementById('goBestVal');
    if (bestEl) bestEl.textContent = best;

    const goMapBtn = document.getElementById('goMapBtn');
    if (goMapBtn) goMapBtn.style.display = inPath ? 'inline-flex' : 'none';

    openModal('gameOverModal');
  }

  // --- Goal & Level Completion ---
  function updateGoalBanner() {
    const banner = document.getElementById('goalBanner');
    if (gameMode !== 'path' || currentPathLevel < 0) { banner.style.display = 'none'; return; }
    const goal = PATH_LEVELS[currentPathLevel];
    banner.style.display = 'flex';
    const total = scaledTarget(goal.target);
    let progress = goal.type === 'reachLevel' ? Math.min(highestLevel, total) : Math.min(mergesCount, total);
    const label = currentLang === 'ru' ? goal.labelRu : goal.labelEn;
    document.getElementById('goalLabel').textContent = `${label} (${progress}/${total})`;
    document.getElementById('goalBarFill').style.width = Math.round((progress / total) * 100) + '%';
  }

  function checkGoalCompletion() {
    if (gameMode !== 'path' || currentPathLevel < 0 || goalAchieved || gameOver) return;
    const goal = PATH_LEVELS[currentPathLevel];
    const total = scaledTarget(goal.target);
    const done = goal.type === 'reachLevel' ? highestLevel >= total : mergesCount >= total;

    if (done) {
      goalAchieved = true;
      running = false;
      updateMissionsProgress(0, score, highestLevel);
      try { ysdk?.features?.GameplayAPI?.stop?.(); } catch(e){}
      pathProgress()[currentPathLevel] = true;
      safeStorage.setItem('mergeTowerProgressByTier', JSON.stringify(pathProgressAll));
      clearLevelSave();

      const clean = toolsUsedThisLevel === 0;
      const reward = clean ? 12 : 6;
      addStars(reward);
      triggerCharDance();
      setTimeout(showLevelComplete, 350);
    }
  }

  function showLevelComplete() {
    const hasNext = currentPathLevel + 1 < PATH_LEVELS.length;
    const reward = toolsUsedThisLevel === 0 ? 12 : 6;

    const lvlEl = document.getElementById('compLevelText');
    if (lvlEl) lvlEl.textContent = (currentLang === 'ru' ? 'Уровень ' : 'Level ') + (currentPathLevel + 1);
    const scoreEl = document.getElementById('compScoreVal');
    if (scoreEl) scoreEl.textContent = score;
    const mergesEl = document.getElementById('compMergesVal');
    if (mergesEl) mergesEl.textContent = mergesCount;
    const rewardEl = document.getElementById('compRewardVal');
    if (rewardEl) rewardEl.textContent = '+' + reward + ' ★';

    const s1 = document.getElementById('compStar1');
    const s2 = document.getElementById('compStar2');
    const s3 = document.getElementById('compStar3');
    [s1, s2, s3].forEach(s => {
      if (s) {
        s.classList.remove('earned');
        s.style.opacity = '0.3';
        s.style.transform = 'scale(0.85)';
      }
    });

    const nextBtn = document.getElementById('compNextBtn');
    if (nextBtn) nextBtn.style.display = hasNext ? 'inline-flex' : 'none';

    openModal('completeModal');

    // Chime animations
    setTimeout(() => {
      if (s1) { s1.classList.add('earned'); s1.style.opacity = '1'; s1.style.transform = 'scale(1.25)'; playStarChime(0); triggerHaptic([20]); }
    }, 280);
    setTimeout(() => {
      if (s2) { s2.classList.add('earned'); s2.style.opacity = '1'; s2.style.transform = 'scale(1.25)'; playStarChime(1); triggerHaptic([25]); }
    }, 560);
    if (toolsUsedThisLevel === 0) {
      setTimeout(() => {
        if (s3) { s3.classList.add('earned'); s3.style.opacity = '1'; s3.style.transform = 'scale(1.25)'; playStarChime(2); triggerHaptic([35]); }
      }, 860);
    }
  }

  function startPathLevel(i) {
    gameMode = 'path';
    currentPathLevel = i;
    applyTheme(PATH_LEVELS[i].loc);
    startGame();
  }

  // --- Map Modal ---
  let activeMapLoc = 0;
  function renderMapModal() {
    const list = document.getElementById('mapLocationsList') || document.getElementById('mapContainer');
    if (!list) return;
    list.innerHTML = '';

    const tabsContainer = document.createElement('div');
    tabsContainer.style.display = 'flex';
    tabsContainer.style.justifyContent = 'center';
    tabsContainer.style.gap = '8px';
    tabsContainer.style.marginBottom = '14px';
    tabsContainer.style.flexWrap = 'wrap';

    LOCATIONS.forEach((loc, locIdx) => {
      const tab = document.createElement('button');
      tab.className = `loc-tab-btn ${locIdx === activeMapLoc ? 'active' : ''}`;
      tab.style.padding = '6px 14px';
      tab.style.fontSize = '12px';
      tab.style.fontWeight = '800';
      tab.style.borderRadius = '999px';
      tab.style.border = locIdx === activeMapLoc ? '2px solid #ffd23f' : '1px solid rgba(255,255,255,0.2)';
      tab.style.background = locIdx === activeMapLoc ? 'linear-gradient(135deg, rgba(255,210,63,0.35), rgba(255,61,154,0.25))' : 'rgba(255,255,255,0.06)';
      tab.style.color = '#fff';
      tab.style.cursor = 'pointer';
      tab.innerHTML = `${loc.icon} ${currentLang === 'ru' ? loc.name : loc.nameEn}`;
      bindTap(tab, () => {
        activeMapLoc = locIdx;
        renderMapModal();
      });
      tabsContainer.appendChild(tab);
    });
    list.appendChild(tabsContainer);

    const grid = document.createElement('div');
    grid.className = 'map-path-grid';

    const levelsOfLoc = [];
    PATH_LEVELS.forEach((pl, i) => { if (pl.loc === activeMapLoc) levelsOfLoc.push({ ...pl, globalIndex: i }); });

    levelsOfLoc.forEach((lv, n) => {
      const idx = lv.globalIndex;
      const unlocked = isLevelUnlocked(idx);
      const done = pathProgress()[idx];
      const isCurrent = unlocked && !done && (idx === 0 || pathProgress()[idx - 1]);

      const node = document.createElement('button');
      node.className = `map-node ${unlocked ? 'unlocked' : 'locked'} ${done ? 'done' : ''} ${isCurrent ? 'current' : ''}`;
      
      const starsHtml = done ? '⭐⭐⭐' : (unlocked ? '☆☆☆' : '');
      node.innerHTML = `
        <span class="map-node-num">${unlocked ? (n + 1) : '🔒'}</span>
        ${starsHtml ? `<span class="map-node-stars">${starsHtml}</span>` : ''}
      `;

      if (unlocked) {
        bindTap(node, () => {
          closeModal('mapModal');
          startPathLevel(idx);
        });
      }
      grid.appendChild(node);
    });

    list.appendChild(grid);
  }

  // --- Daily Challenge ---
  let dailyRngState = 12345;
  function dailyRandom() {
    dailyRngState = (dailyRngState * 1664525 + 1013904223) >>> 0;
    return dailyRngState / 4294967296;
  }
  function dailyDateKey() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  }
  function startDailyChallenge() {
    gameMode = 'daily';
    currentPathLevel = -1;
    dailyRngState = 777;
    applyTheme(0);
    closeAllModals();
    startGame();
  }

  // --- Daily Missions ---
  const DAILY_MISSIONS = [
    {
      id: 'merges',
      icon: '⚡',
      nameKey: 'missionMergesName',
      descKey: 'missionMergesDesc',
      nameDefault: 'Мастер слияний',
      descDefault: 'Сделай 10 слияний',
      target: 10,
      reward: 8
    },
    {
      id: 'score',
      icon: '🏆',
      nameKey: 'missionScoreName',
      descKey: 'missionScoreDesc',
      nameDefault: 'Звёздный разгон',
      descDefault: 'Набери 500 очков',
      target: 500,
      reward: 10
    },
    {
      id: 'level',
      icon: '🔮',
      nameKey: 'missionLevelName',
      descKey: 'missionLevelDesc',
      nameDefault: 'Сфера Титана',
      descDefault: 'Создай шар 5 уровня',
      target: 5,
      reward: 12
    }
  ];

  function loadMissionState() {
    const today = dailyDateKey();
    try {
      const raw = safeStorage.getItem('mergeTowerMissions');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.day === today && parsed.progress && parsed.claimed) {
          return parsed;
        }
      }
    } catch(e){}
    return { day: today, progress: { merges: 0, score: 0, level: 0 }, claimed: {} };
  }

  let missionState = loadMissionState();

  function saveMissionState() {
    safeStorage.setItem('mergeTowerMissions', JSON.stringify(missionState));
    queueCloudSave();
  }

  function getUnclaimedMissionsCount() {
    let count = 0;
    DAILY_MISSIONS.forEach(m => {
      const prog = missionState.progress[m.id] || 0;
      if (prog >= m.target && !missionState.claimed[m.id]) count++;
    });
    return count;
  }

  function updateMissionsBadge() {
    const badge = document.getElementById('missionsBadge');
    if (!badge) return;
    const ready = getUnclaimedMissionsCount();
    if (ready > 0) {
      badge.textContent = ready > 1 ? ready : '!';
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  }

  function updateMissionsProgress(addMerges = 0, currentRunScore = 0, currentRunLevel = 0) {
    const today = dailyDateKey();
    if (missionState.day !== today) {
      missionState = { day: today, progress: { merges: 0, score: 0, level: 0 }, claimed: {} };
    }
    let changed = false;
    if (addMerges > 0) {
      missionState.progress.merges = (missionState.progress.merges || 0) + addMerges;
      changed = true;
    }
    if (currentRunScore > 0 && currentRunScore > (missionState.progress.score || 0)) {
      missionState.progress.score = currentRunScore;
      changed = true;
    }
    if (currentRunLevel > 0 && currentRunLevel > (missionState.progress.level || 0)) {
      missionState.progress.level = currentRunLevel;
      changed = true;
    }
    if (changed) {
      saveMissionState();
      updateMissionsBadge();
    }
  }

  function renderMissions() {
    const list = document.getElementById('missionsList');
    if (!list) return;
    list.innerHTML = '';
    const today = dailyDateKey();
    if (missionState.day !== today) {
      missionState = { day: today, progress: { merges: 0, score: 0, level: 0 }, claimed: {} };
      saveMissionState();
    }

    const dateText = document.getElementById('missionsDateText');
    if (dateText) {
      dateText.textContent = `📅 ${today}`;
    }

    const unclaimed = getUnclaimedMissionsCount();
    const readyText = document.getElementById('missionsReadyText');
    if (readyText) {
      if (unclaimed > 0) {
        readyText.textContent = `✨ ${t('missionReady') || 'Награда готова!'} (${unclaimed})`;
        readyText.style.color = '#ffd23f';
      } else {
        const allClaimed = DAILY_MISSIONS.every(m => !!missionState.claimed[m.id]);
        readyText.textContent = allClaimed ? `✔ ${t('missionAllDone') || 'Все выполнены!'}` : '';
        readyText.style.color = '#52b788';
      }
    }

    DAILY_MISSIONS.forEach(m => {
      const p = Math.min(m.target, missionState.progress[m.id] || 0);
      const done = p >= m.target;
      const claimed = !!missionState.claimed[m.id];
      const pct = Math.min(100, Math.round((p / m.target) * 100));

      const title = t(m.nameKey) || m.nameDefault;
      const desc = t(m.descKey) || m.descDefault;

      const card = document.createElement('div');
      card.className = 'mission-card' + (done && !claimed ? ' mission-ready' : '') + (claimed ? ' mission-done' : '');

      card.innerHTML = `
        <div style="font-size:22px; width:36px; height:36px; border-radius:12px; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.15); flex-shrink:0;">
          ${m.icon}
        </div>
        <div style="flex:1; min-width:0; text-align:left;">
          <div style="color:#fff; font-weight:800; font-size:13px; line-height:1.2;">${title}</div>
          <div style="color:var(--text-dim); font-size:11px; margin-top:2px;">${desc}</div>
          <div style="display:flex; align-items:center; gap:6px; margin-top:5px;">
            <div style="flex:1; height:6px; background:rgba(255,255,255,0.12); border-radius:999px; overflow:hidden;">
              <div style="height:100%; width:${pct}%; background:${claimed ? '#52b788' : (done ? 'linear-gradient(90deg, #4deeea, #ffd23f)' : 'linear-gradient(90deg, #9a7bff, #4deeea)')}; transition:width 0.3s ease;"></div>
            </div>
            <span style="font-size:10px; font-weight:800; color:${done ? '#ffd23f' : 'var(--text-dim)'}; white-space:nowrap;">${p}/${m.target}</span>
          </div>
        </div>
        <div>
          ${claimed ? `
            <button disabled style="padding:6px 10px; border-radius:999px; border:1px solid rgba(255,255,255,0.2); background:rgba(255,255,255,0.06); color:#8794c7; font-size:11px; font-weight:800; cursor:default; white-space:nowrap;">
              ${t('missionClaimed') || '✔ Получено'}
            </button>
          ` : (done ? `
            <button class="mission-claim-btn" data-m="${m.id}" style="padding:7px 12px; font-size:12px; font-weight:900; border-radius:999px; background:linear-gradient(180deg, #ffe78a 0%, #f6ba16 100%); color:#3e2802; border:2px solid #fff; box-shadow:0 0 12px rgba(255,210,63,0.5), 0 3px 0 #8f6504; cursor:pointer; white-space:nowrap;">
              ${t('missionClaim') || 'Забрать'} +${m.reward}★
            </button>
          ` : `
            <button class="shop-buy-btn" disabled style="padding:6px 10px; font-size:11px; opacity:0.4; cursor:default; white-space:nowrap;">
              +${m.reward}★
            </button>
          `)}
        </div>
      `;
      list.appendChild(card);
    });

    list.querySelectorAll('.mission-claim-btn').forEach(btn => {
      bindTap(btn, () => {
        const id = btn.dataset.m;
        const m = DAILY_MISSIONS.find(x => x.id === id);
        if (!m || missionState.claimed[id]) return;
        const prog = missionState.progress[id] || 0;
        if (prog < m.target) return;

        missionState.claimed[id] = true;
        addStars(m.reward);
        saveMissionState();
        updateMissionsBadge();
        playStarChime(0);
        triggerHaptic([25, 20, 35]);

        floatingTexts.push({
          x: W / 2,
          y: H * 0.45,
          text: `+${m.reward}★`,
          life: 60,
          maxLife: 60,
          color: '#ffd23f',
          size: 20
        });

        renderMissions();
      });
    });
  }

  // --- Achievements ---
  const ACHIEVEMENTS = [
    { id: 'first_merge', name: 'Первое слияние', desc: 'Слей два шара впервые', reward: 5, check: s => s.totalMerges >= 1 },
    { id: 'merge_50', name: 'Алхимик', desc: 'Сделай 50 слияний', reward: 10, check: s => s.totalMerges >= 50 },
    { id: 'merge_150', name: 'Мастер шаров', desc: 'Сделай 150 слияний', reward: 20, check: s => s.totalMerges >= 150 },
    { id: 'star_ball', name: 'До звёзд!', desc: 'Создай звезду ★', reward: 25, check: s => s.maxLevelEver >= 9 },
    { id: 'score_1000', name: 'Тысячник', desc: 'Набери 1000 очков', reward: 10, check: s => s.bestScore >= 1000 },
    { id: 'score_5000', name: 'Небоскрёб', desc: 'Набери 5000 очков', reward: 25, check: s => s.bestScore >= 5000 },
  ];
  function loadAchState() {
    try {
      const raw = safeStorage.getItem('mergeTowerAchState');
      if (raw) return JSON.parse(raw);
    } catch(e){}
    return { totalMerges: 0, maxLevelEver: 0, bestScore: 0, unlocked: {} };
  }
  let achState = loadAchState();
  function saveAchState() { safeStorage.setItem('mergeTowerAchState', JSON.stringify(achState)); }
  function checkAchievements() {
    let newOne = false;
    ACHIEVEMENTS.forEach(a => {
      if (!achState.unlocked[a.id] && a.check(achState)) {
        achState.unlocked[a.id] = true;
        addStars(a.reward);
        newOne = true;
        showAchievementToast(a);
      }
    });
    if (newOne) {
      saveAchState();
      queueCloudSave();
      updateAchievementsBadge();
    }
  }
  function showAchievementToast(a) {
    const el = document.createElement('div');
    el.className = 'ach-toast';
    el.innerHTML = `<div>🏆</div><div><div style="font-weight:800;font-size:13px;color:#fff;">${a.name}</div><div style="font-size:11px;color:#ffd23f;">+${a.reward}★</div></div>`;
    document.body.appendChild(el);
    setTimeout(() => { el.classList.add('ach-toast-out'); setTimeout(() => el.remove(), 400); }, 2400);
  }
  function updateAchievementsBadge() {
    const count = Object.keys(achState.unlocked || {}).length;
    const el = document.getElementById('achBadge');
    if (el) el.textContent = `${count}/${ACHIEVEMENTS.length}`;
  }
  function renderAchievements() {
    const list = document.getElementById('achList');
    if (!list) return;
    list.innerHTML = '';
    ACHIEVEMENTS.forEach(a => {
      const done = !!achState.unlocked[a.id];
      const card = document.createElement('div');
      card.className = 'ach-item';
      card.innerHTML = `
        <div style="font-size:20px;">${done ? '🏆' : '🔒'}</div>
        <div class="ach-info">
          <div class="ach-name">${a.name}</div>
          <div class="ach-desc">${a.desc}</div>
        </div>
        <div style="color:#ffd23f;font-weight:800;font-size:12px;">${done ? '✔' : `+${a.reward}★`}</div>
      `;
      list.appendChild(card);
    });
  }

  // --- Upgrades Modal ---
  function renderUpgradesModal() {
    const starsEl = document.getElementById('upgradesStarsVal');
    if (starsEl) starsEl.textContent = starCoins;
    const list = document.getElementById('upgradesList');
    if (!list) return;
    list.innerHTML = '';

    UPGRADES_DEF.forEach(u => {
      const curLvl = getUpgradeLevel(u.id);
      const isMax = curLvl >= u.max;
      const cost = getUpgradeCost(u);
      const name = currentLang === 'ru' ? u.nameRu : u.nameEn;
      const desc = currentLang === 'ru' ? u.descRu : u.descEn;

      let pipsHtml = '';
      for (let i = 0; i < u.max; i++) {
        pipsHtml += `<div class="upgrade-pip ${i < curLvl ? 'filled' : ''}"></div>`;
      }

      const card = document.createElement('div');
      card.className = 'upgrade-item';
      card.innerHTML = `
        <div class="upgrade-icon">${u.icon}</div>
        <div class="upgrade-info">
          <div class="upgrade-name">${name}</div>
          <div class="upgrade-desc">${desc}</div>
          <div class="upgrade-pips">${pipsHtml}</div>
        </div>
        <button class="upgrade-action-btn ${isMax ? 'upgrade-max' : ''}" data-up="${u.id}" ${(!isMax && starCoins >= cost) ? '' : 'disabled'}>
          ${isMax ? 'MAX' : '★' + cost}
        </button>
      `;
      list.appendChild(card);
    });

    list.querySelectorAll('.upgrade-action-btn').forEach(btn => {
      if (btn.classList.contains('upgrade-max')) return;
      bindTap(btn, () => {
        const id = btn.dataset.up;
        const def = UPGRADES_DEF.find(x => x.id === id);
        if (!def) return;
        const cost = getUpgradeCost(def);
        if (spendStars(cost)) {
          upgrades[id] = (upgrades[id] || 0) + 1;
          saveUpgrades();
          playStarChime(2);
          triggerHaptic([30, 20]);
          renderUpgradesModal();
          updateNudgeUI();
        }
      });
    });
  }

  // --- Shop Modal ---
  function renderShopModal() {
    const starsEl = document.getElementById('shopStarsVal') || document.getElementById('shopModalStarsVal');
    if (starsEl) starsEl.textContent = starCoins;
    const list = document.getElementById('shopList');
    if (!list) return;
    list.innerHTML = '';

    const toolsSec = document.createElement('div');
    toolsSec.style.width = '100%';
    toolsSec.innerHTML = `<div style="font-size:12px;font-weight:900;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin:4px 0 8px;">${currentLang === 'ru' ? 'Инструменты' : 'Power-ups'}</div>`;

    [
      { id: 'shrink', icon: '🔧', name: 'Уменьшитель', desc: 'Снижает шар на 1 уровень', cost: 4 },
      { id: 'bomb', icon: '💣', name: 'Бомба', desc: 'Взрывает опасный шар', cost: 6 },
      { id: 'swap', icon: '🔄', name: 'Свап', desc: 'Меняет шар с запасным', cost: 3 },
    ].forEach(it => {
      const card = document.createElement('div');
      card.className = 'shop-item';
      card.innerHTML = `
        <div style="font-size:24px;">${it.icon}</div>
        <div class="si-info">
          <div class="si-name">${it.name}</div>
          <div class="si-desc">${it.desc} (×${inventory[it.id] || 0})</div>
        </div>
        <button class="shop-buy-btn" data-tool="${it.id}" ${starCoins < it.cost ? 'disabled' : ''}>★${it.cost}</button>
      `;
      toolsSec.appendChild(card);
    });
    list.appendChild(toolsSec);

    toolsSec.querySelectorAll('[data-tool]').forEach(btn => {
      bindTap(btn, () => {
        const id = btn.dataset.tool;
        const cost = TOOL_COST[id];
        if (spendStars(cost)) {
          inventory[id] = (inventory[id] || 0) + 1;
          saveInventory();
          playStarChime(0);
          triggerHaptic([25]);
          renderShopModal();
          updateToolButtons();
        }
      });
    });

    const skinsSec = document.createElement('div');
    skinsSec.style.width = '100%';
    skinsSec.style.marginTop = '12px';
    skinsSec.innerHTML = `<div style="font-size:12px;font-weight:900;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin:6px 0 8px;">${currentLang === 'ru' ? 'Облики шаров' : 'Ball Themes'}</div>`;

    SKINS.forEach(sk => {
      const owned = ownedSkins.includes(sk.id);
      const equipped = equippedSkin === sk.id;
      const card = document.createElement('div');
      card.className = 'shop-item';
      card.innerHTML = `
        <div style="font-size:22px;">🔮</div>
        <div class="si-info">
          <div class="si-name">${currentLang === 'ru' ? sk.name : sk.nameEn}</div>
          <div class="si-desc">${sk.desc}</div>
        </div>
        <button class="shop-buy-btn ${equipped ? 'equipped' : ''}" data-skin="${sk.id}" ${(!owned && starCoins < sk.cost) ? 'disabled' : ''}>
          ${equipped ? (currentLang === 'ru' ? '✔ Взят' : '✔ Active') : (owned ? (currentLang === 'ru' ? 'Надеть' : 'Equip') : '★' + sk.cost)}
        </button>
      `;
      skinsSec.appendChild(card);
    });
    list.appendChild(skinsSec);

    skinsSec.querySelectorAll('[data-skin]').forEach(btn => {
      bindTap(btn, () => {
        const id = btn.dataset.skin;
        const sk = SKINS.find(x => x.id === id);
        if (!sk) return;
        if (ownedSkins.includes(id)) {
          equippedSkin = id;
          safeStorage.setItem('mergeTowerEquippedSkin', id);
          queueCloudSave();
          renderShopModal();
        } else if (spendStars(sk.cost)) {
          ownedSkins.push(id);
          equippedSkin = id;
          safeStorage.setItem('mergeTowerOwnedSkins', JSON.stringify(ownedSkins));
          safeStorage.setItem('mergeTowerEquippedSkin', id);
          queueCloudSave();
          playStarChime(1);
          renderShopModal();
        }
      });
    });
  }

  // --- Rules Modal ---
  const RULES_DATA = {
    basics: {
      ru: `
        <div class="rules-step">
          <div class="rules-step-num">1</div>
          <div class="rules-step-text"><b>Прицеливайся и бросай:</b> Веди пальцем или мышью по горизонтали, чтобы точно навести сферу. Отпусти — шар упадёт в башню.</div>
        </div>
        <div class="rules-step">
          <div class="rules-step-num">2</div>
          <div class="rules-step-text"><b>Слияние сфер:</b> При соприкосновении двух одинаковых шаров они мгновенно объединяются в сферу следующего уровня!</div>
        </div>
        <div class="rules-step">
          <div class="rules-step-num">3</div>
          <div class="rules-step-text"><b>Красная линия опасности:</b> Не позволяй шарам оставаться выше контрольной линии. При переполнении башня обрушится!</div>
        </div>
      `,
      en: `
        <div class="rules-step">
          <div class="rules-step-num">1</div>
          <div class="rules-step-text"><b>Aim & Drop:</b> Slide your finger or mouse horizontally to align the orb. Release to drop into the reactor tube.</div>
        </div>
        <div class="rules-step">
          <div class="rules-step-num">2</div>
          <div class="rules-step-text"><b>Sphere Fusion:</b> When two matching spheres touch, they instantaneously merge into the next higher level!</div>
        </div>
        <div class="rules-step">
          <div class="rules-step-num">3</div>
          <div class="rules-step-text"><b>Danger Threshold:</b> Keep orbs below the red warning line. Sustained overflow triggers critical collapse!</div>
        </div>
      `
    },
    wildcard: {
      ru: `
        <div class="rules-step">
          <div class="rules-step-num">✦</div>
          <div class="rules-step-text"><b>Джокер-сфера (Wildcard):</b> Радужная светящаяся сфера соединяется с <i>любым</i> стандартным шаром (кроме высшей звезды). Идеальна для спасения от переполнения!</div>
        </div>
        <div class="rules-step">
          <div class="rules-step-num">🌌</div>
          <div class="rules-step-text"><b>Суперновая:</b> Слияние двух максимальных звёзд ★ вызывает космический катаклизм, очищающий поле от лишних сфер с огромным бонусом очков и звёзд!</div>
        </div>
      `,
      en: `
        <div class="rules-step">
          <div class="rules-step-num">✦</div>
          <div class="rules-step-text"><b>Wildcard Sphere:</b> The rainbow chromatic sphere merges with <i>any</i> sphere. A lifesaver in critical situations!</div>
        </div>
        <div class="rules-step">
          <div class="rules-step-num">🌌</div>
          <div class="rules-step-text"><b>Supernova Collapse:</b> Merging two tier-★ stars unleashes a cosmic supernova that clears debris and grants massive star coins!</div>
        </div>
      `
    },
    combos: {
      ru: `
        <div class="rules-step">
          <div class="rules-step-num">×</div>
          <div class="rules-step-text"><b>Цепные реакции:</b> Если одно слияние вызывает последующие, множитель очков взлетает до ×5!</div>
        </div>
        <div class="rules-step">
          <div class="rules-step-num">⏱️</div>
          <div class="rules-step-text"><b>Окно комбо:</b> Каждое слияние продлевает таймер серии. Прокачивай «Комбо-поток», чтобы легче удерживать максимальный множитель!</div>
        </div>
      `,
      en: `
        <div class="rules-step">
          <div class="rules-step-num">×</div>
          <div class="rules-step-text"><b>Chain Reactions:</b> Triggering cascade merges accelerates your multiplier up to ×5!</div>
        </div>
        <div class="rules-step">
          <div class="rules-step-num">⏱️</div>
          <div class="rules-step-text"><b>Combo Window:</b> Each merge replenishes the combo timer. Upgrade Combo Flux to extend window duration!</div>
        </div>
      `
    },
    upgrades: {
      ru: `
        <div class="rules-step">
          <div class="rules-step-num">🌀</div>
          <div class="rules-step-text"><b>Грав-Магнит:</b> Притягивает парные шары друг к другу при близком расстоянии, спасая от случайных застреваний.</div>
        </div>
        <div class="rules-step">
          <div class="rules-step-num">📳</div>
          <div class="rules-step-text"><b>Тактический толчок (Nudge):</b> Кнопка на панели даёт мягкий импульс физике, помогая шарам упасть в нужные лунки.</div>
        </div>
      `,
      en: `
        <div class="rules-step">
          <div class="rules-step-num">🌀</div>
          <div class="rules-step-text"><b>Grav-Magnet:</b> Creates mutual attraction between nearby matching spheres to avoid deadlocks.</div>
        </div>
        <div class="rules-step">
          <div class="rules-step-num">📳</div>
          <div class="rules-step-text"><b>Tactical Nudge:</b> Push the toolbar button to gently shake settled spheres into place.</div>
        </div>
      `
    }
  };

  function setRulesTab(tabKey) {
    document.querySelectorAll('.rules-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabKey);
    });
    const content = document.getElementById('rulesContent');
    if (!content) return;
    const data = RULES_DATA[tabKey] || RULES_DATA.basics;
    content.innerHTML = currentLang === 'ru' ? data.ru : data.en;
  }

  // --- Settings Modal ---
  function initSettingsModal() {
    const musicSlider = document.getElementById('musicSlider');
    const soundSlider = document.getElementById('soundSlider');
    const musicText = document.getElementById('musicValText');
    const soundText = document.getElementById('soundValText');

    if (musicSlider) {
      musicSlider.value = Math.round(musicVolume * 100);
      if (musicText) musicText.textContent = musicSlider.value + '%';
      musicSlider.addEventListener('input', e => setMusicVolume(Number(e.target.value) / 100));
    }
    if (soundSlider) {
      soundSlider.value = Math.round(sfxVolume * 100);
      if (soundText) soundText.textContent = soundSlider.value + '%';
      soundSlider.addEventListener('input', e => AudioManager.setSfxVolume(Number(e.target.value) / 100, true));
    }
  }

  // --- Tutorial ---
  const tutorialEl = document.getElementById('tutorial');
  let tutorialActive = false;
  function shouldShowTutorial() { return !safeStorage.getItem('mergeTowerTutorialDone'); }
  function startTutorial() {
    tutorialActive = true;
    if (tutorialEl) tutorialEl.classList.remove('tutorial-hidden');
  }
  function endTutorial() {
    tutorialActive = false;
    if (tutorialEl) tutorialEl.classList.add('tutorial-hidden');
    safeStorage.setItem('mergeTowerTutorialDone', '1');
  }
  bindTap(document.getElementById('tutSkip'), endTutorial);

  // --- Daily Bonus ---
  function updateDailyBonusUI() {
    const btn = document.getElementById('dailyBonusBtn');
    if (!btn) return;
    const available = safeStorage.getItem('mergeTowerDailyClaim') !== dailyDateKey();
    btn.style.display = available ? 'flex' : 'none';
  }

  function renderDifficultyRow() {
    const row = document.getElementById('difficultyRow');
    if (!row) return;
    row.innerHTML = '';
    DIFFICULTIES.forEach((d, i) => {
      const unlocked = i <= difficultyState.unlocked;
      const btn = document.createElement('button');
      btn.className = `diff-btn ${i === difficultyState.current ? 'diff-active' : ''} ${unlocked ? '' : 'diff-locked'}`;
      btn.innerHTML = `<span>${d.icon}</span><span>${currentLang === 'ru' ? d.name : d.nameEn}</span>`;
      if (unlocked) {
        bindTap(btn, () => {
          difficultyState.current = i;
          safeStorage.setItem('mergeTowerDifficulty', JSON.stringify(difficultyState));
          renderDifficultyRow();
        });
      }
      row.appendChild(btn);
    });
  }

  // --- Heroes of Might and Magic V: Cosmic Citadel & Singularity Interface ---
  let selectedMenuMode = 'endless';
  let heroStageAnimId = null;

  function initHommCitadelInterface() {
    const heroCanvas = document.getElementById('hommHeroCanvas');
    if (!heroCanvas) return;
    const hctx = heroCanvas.getContext('2d');
    const heroWrap = document.getElementById('hommHeroStageWrap');
    const hintEl = document.getElementById('hommCharHint');

    // Singularity accretion dust particles
    const singParticles = Array.from({ length: 22 }, () => ({
      dist: 16 + Math.random() * 34,
      theta: Math.random() * Math.PI * 2,
      speed: (0.02 + Math.random() * 0.035),
      size: 1.2 + Math.random() * 2.2,
      color: Math.random() > 0.4 ? '#ffd23f' : '#ff7dbf'
    }));

    // Sparkles from clicking mascot
    let mascotSparkles = [];

    // Mascot state
    let mascot = {
      baseX: 180, baseY: 114,
      flipProgress: 0,
      blinkTimer: 180,
      isBlinking: false,
      lookX: 0, lookY: 0
    };

    // Track mouse / touch on stage to move mascot's eyes
    if (heroWrap) {
      const updateLook = (clientX, clientY) => {
        const rect = heroCanvas.getBoundingClientRect();
        const normX = (clientX - rect.left) / rect.width - 0.5;
        const normY = (clientY - rect.top) / rect.height - 0.5;
        mascot.lookX = clamp(normX * 6, -3, 3);
        mascot.lookY = clamp(normY * 4, -2, 3);
      };
      heroWrap.addEventListener('pointermove', e => updateLook(e.clientX, e.clientY));
      heroWrap.addEventListener('pointerdown', e => {
        updateLook(e.clientX, e.clientY);
        // Flip & Star burst!
        mascot.flipProgress = 1.0;
        try { AudioManager.playArchonResonance(); } catch(err) {}
        try { AudioManager.playButtonClick(); } catch(err) {}
        try { AudioManager.playStarChime(2); } catch(err) {}
        triggerHaptic([35, 20, 50]);

        for (let i = 0; i < 18; i++) {
          const ang = Math.random() * Math.PI * 2;
          const spd = 1.5 + Math.random() * 3.5;
          mascotSparkles.push({
            x: mascot.baseX,
            y: mascot.baseY - 4,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            size: 2 + Math.random() * 3,
            color: Math.random() > 0.5 ? '#ffd23f' : '#4deeea',
            life: 30, maxLife: 30
          });
        }

        // Cheerful mascot hint quotes
        const mascotPack = MASCOT_QUOTES[currentMascot] || MASCOT_QUOTES.lumi;
        const phrases = currentLang === 'ru' ? mascotPack.ru : mascotPack.en;
        if (hintEl) {
          hintEl.textContent = phrases[Math.floor(Math.random() * phrases.length)];
          hintEl.style.color = currentMascot === 'bot' ? '#38bdf8' : (currentMascot === 'dragon' ? '#f59e0b' : (currentMascot === 'knight' ? '#ffd23f' : '#e879f9'));
        }
      });
    }

    // Set active House visually
    function updateHouseUI() {
      const houses = ['chrono', 'singularity', 'pulsar', 'nebula'];
      houses.forEach(h => {
        const btn = document.getElementById('house' + h.charAt(0).toUpperCase() + h.slice(1));
        if (btn) btn.classList.toggle('active', currentHouse === h);
      });
      const badge = document.getElementById('hommHousePerkBadge');
      if (badge) {
        badge.textContent = t('house_' + currentHouse + '_desc');
      }
      updateHouseActiveBadge();
    }

    // Bind House buttons
    const houseConfigs = [
      { id: 'chrono', btn: 'houseChrono' },
      { id: 'singularity', btn: 'houseSingularity' },
      { id: 'pulsar', btn: 'housePulsar' },
      { id: 'nebula', btn: 'houseNebula' }
    ];
    houseConfigs.forEach(({ id, btn }) => {
      const el = document.getElementById(btn);
      if (el) {
        bindTap(el, () => {
          currentHouse = id;
          safeStorage.setItem('mergeTowerHouse', id);
          queueCloudSave(true);
          updateHouseUI();
          try { AudioManager.playButtonClick(); } catch(err) {}
          triggerHaptic(20);
        });
      }
    });
    updateHouseUI();

    // Set active Mascot Archetype visually
    function updateMascotUI() {
      const mascots = ['lumi', 'bot', 'dragon', 'knight'];
      mascots.forEach(m => {
        const btn = document.getElementById('mascotBtn_' + m);
        if (btn) btn.classList.toggle('active', currentMascot === m);
      });
      if (hintEl) {
        const mascotPack = MASCOT_QUOTES[currentMascot] || MASCOT_QUOTES.lumi;
        const phrases = currentLang === 'ru' ? mascotPack.ru : mascotPack.en;
        hintEl.textContent = phrases[0];
        hintEl.style.color = currentMascot === 'bot' ? '#38bdf8' : (currentMascot === 'dragon' ? '#f59e0b' : (currentMascot === 'knight' ? '#ffd23f' : '#e879f9'));
      }
    }

    // Bind Mascot Archetype selector buttons
    const mascotIds = ['lumi', 'bot', 'dragon', 'knight'];
    mascotIds.forEach(mId => {
      const el = document.getElementById('mascotBtn_' + mId);
      if (el) {
        bindTap(el, () => {
          currentMascot = mId;
          safeStorage.setItem('mergeTowerMascot', mId);
          queueCloudSave(true);
          updateMascotUI();
          mascot.flipProgress = 1.0;
          try { AudioManager.playArchonResonance(); } catch(err) {}
          try { AudioManager.playButtonClick(); } catch(err) {}
          triggerHaptic(30);
          for (let i = 0; i < 16; i++) {
            const ang = Math.random() * Math.PI * 2;
            const spd = 1.8 + Math.random() * 3.2;
            mascotSparkles.push({
              x: mascot.baseX,
              y: mascot.baseY - 4,
              vx: Math.cos(ang) * spd,
              vy: Math.sin(ang) * spd,
              size: 2 + Math.random() * 3,
              color: currentMascot === 'bot' ? '#38bdf8' : (currentMascot === 'dragon' ? '#f59e0b' : (currentMascot === 'knight' ? '#ffd23f' : '#e879f9')),
              life: 28, maxLife: 28
            });
          }
        });
      }
    });
    updateMascotUI();

    // Mode tabs
    function updateModeTabsUI() {
      const tabs = [
        { id: 'endless', tabEl: 'endlessModeTab', titleRu: 'В БОЙ', titleEn: 'BATTLE' },
        { id: 'path', tabEl: 'pathModeTab', titleRu: 'В ПОХОД', titleEn: 'EXPEDITION' },
        { id: 'daily', tabEl: 'dailyModeTab', titleRu: 'ИСПЫТАНИЕ', titleEn: 'TRIAL' }
      ];
      tabs.forEach(t => {
        const el = document.getElementById(t.tabEl);
        if (el) el.classList.toggle('active', selectedMenuMode === t.id);
        if (selectedMenuMode === t.id) {
          const titleEl = document.getElementById('heroPlayTitle');
          if (titleEl) titleEl.textContent = currentLang === 'ru' ? t.titleRu : t.titleEn;
        }
      });
    }

    bindTap(document.getElementById('endlessModeTab'), () => {
      selectedMenuMode = 'endless';
      updateModeTabsUI();
      try { AudioManager.playButtonClick(); } catch(err) {}
    });
    bindTap(document.getElementById('pathModeTab'), () => {
      selectedMenuMode = 'path';
      updateModeTabsUI();
      try { AudioManager.playButtonClick(); } catch(err) {}
    });
    bindTap(document.getElementById('dailyModeTab'), () => {
      selectedMenuMode = 'daily';
      updateModeTabsUI();
      try { AudioManager.playButtonClick(); } catch(err) {}
    });
    updateModeTabsUI();

    // Main Hero Play Button
    bindTap(document.getElementById('heroPlayBtn'), () => {
      try { AudioManager.playButtonClick(); } catch(err) {}
      if (selectedMenuMode === 'endless') {
        gameMode = 'endless';
        currentPathLevel = -1;
        applyTheme(0);
        startGame();
      } else if (selectedMenuMode === 'path') {
        renderMapModal();
        openModal('mapModal');
      } else if (selectedMenuMode === 'daily') {
        const seedEl = document.getElementById('dailySeedText');
        if (seedEl) seedEl.textContent = (currentLang === 'ru' ? 'Дата: ' : 'Date: ') + dailyDateKey();
        openModal('dailyModal');
      }
    });

    // Top bar menu buttons
    bindTap(document.getElementById('menuRulesBtn'), () => {
      setRulesTab('basics');
      openModal('rulesModal');
    });
    bindTap(document.getElementById('menuSettingsBtn'), () => {
      openModal('settingsModal');
    });
    bindTap(document.getElementById('cloudBtn'), async () => {
      try {
        await requestYandexAuthorization();
      } catch(err) {}
    });

    // Medallions
    bindTap(document.getElementById('leaderboardBtn'), async () => {
      try {
        const ok = await requestYandexAuthorization();
        if (ok) await submitYandexLeaderboard(best);
        else openModal('rulesModal');
      } catch(err) {}
    });

    // 60FPS Stage Render Loop
    function renderHeroStage() {
      if (!overlay.classList.contains('show')) {
        heroStageAnimId = requestAnimationFrame(renderHeroStage);
        return;
      }
      const now = performance.now();
      const W = heroCanvas.width;
      const H = heroCanvas.height;

      hctx.clearRect(0, 0, W, H);

      // --- 1. Cosmic Nebula Backdrop ---
      const bgGrad = hctx.createRadialGradient(W * 0.72, H * 0.35, 10, W * 0.5, H * 0.5, W * 0.7);
      if (currentHouse === 'singularity') {
        bgGrad.addColorStop(0, '#2a0845');
        bgGrad.addColorStop(0.5, '#120324');
        bgGrad.addColorStop(1, '#05020c');
      } else if (currentHouse === 'pulsar') {
        bgGrad.addColorStop(0, '#451804');
        bgGrad.addColorStop(0.5, '#260a02');
        bgGrad.addColorStop(1, '#0c0301');
      } else if (currentHouse === 'nebula') {
        bgGrad.addColorStop(0, '#06382c');
        bgGrad.addColorStop(0.5, '#041f19');
        bgGrad.addColorStop(1, '#020d0b');
      } else {
        // Chronomancers (Royal Sapphire & Gold)
        bgGrad.addColorStop(0, '#1c2b5e');
        bgGrad.addColorStop(0.5, '#0e173b');
        bgGrad.addColorStop(1, '#060a1c');
      }
      hctx.fillStyle = bgGrad;
      hctx.fillRect(0, 0, W, H);

      // Ambient Twinkling Stars
      for (let s = 0; s < 28; s++) {
        const sx = (s * 37 + 13) % W;
        const sy = (s * 23 + 7) % H;
        const sAlpha = 0.3 + Math.sin(now * 0.003 + s) * 0.3;
        hctx.beginPath();
        hctx.arc(sx, sy, (s % 3 === 0) ? 1.6 : 1.0, 0, Math.PI * 2);
        hctx.fillStyle = `rgba(255,255,255,${sAlpha})`;
        hctx.fill();
      }

      // --- 2. The Astral Merge Citadel (Башня Слияния) ---
      const citX = 72;
      const citY = 145;
      hctx.save();
      // Base Plinth
      hctx.beginPath();
      hctx.ellipse(citX, citY + 22, 38, 11, 0, 0, Math.PI * 2);
      hctx.fillStyle = 'rgba(4, 7, 24, 0.8)';
      hctx.fill();

      // Obsidian Monolith Spire
      hctx.beginPath();
      hctx.moveTo(citX - 22, citY + 20);
      hctx.lineTo(citX - 10, citY - 55);
      hctx.lineTo(citX, citY - 82); // Apex
      hctx.lineTo(citX + 10, citY - 55);
      hctx.lineTo(citX + 22, citY + 20);
      hctx.closePath();
      const citGrad = hctx.createLinearGradient(citX - 20, citY, citX + 20, citY);
      citGrad.addColorStop(0, '#0c1433');
      citGrad.addColorStop(0.5, '#24356e');
      citGrad.addColorStop(1, '#090e24');
      hctx.fillStyle = citGrad;
      hctx.fill();
      hctx.lineWidth = 1.6;
      hctx.strokeStyle = '#d4af37';
      hctx.stroke();

      // Golden Astrolabe Rings around Tower
      const ringAngle = now * 0.0018;
      for (let r = 0; r < 2; r++) {
        const ry = citY - 18 - r * 28;
        const rw = 26 - r * 5;
        const rh = 6 - r * 1.5;
        hctx.beginPath();
        hctx.ellipse(citX, ry, rw, rh, ringAngle * (r === 0 ? 1 : -1), 0, Math.PI * 2);
        hctx.strokeStyle = '#ffd23f';
        hctx.lineWidth = 1.5;
        hctx.stroke();
      }

      // Tower Pulsing Core Mana Line
      const manaPulse = (Math.sin(now * 0.004) + 1) * 0.5;
      hctx.beginPath();
      hctx.moveTo(citX, citY + 18);
      hctx.lineTo(citX, citY - 78);
      hctx.strokeStyle = `rgba(77, 238, 234, ${0.4 + manaPulse * 0.5})`;
      hctx.lineWidth = 2.4;
      hctx.shadowColor = '#4deeea';
      hctx.shadowBlur = 10;
      hctx.stroke();
      hctx.shadowBlur = 0;

      // Pinnacle Star Gem
      hctx.beginPath();
      hctx.arc(citX, citY - 84, 4.5, 0, Math.PI * 2);
      hctx.fillStyle = '#ffd23f';
      hctx.shadowColor = '#ffd23f';
      hctx.shadowBlur = 14;
      hctx.fill();
      hctx.shadowBlur = 0;
      hctx.restore();

      // --- 3. The Cosmic Singularity (Чёрная дыра) ---
      const singX = 276;
      const singY = 56;
      const singR = 15;
      const singColor = currentHouse === 'singularity' ? '#c084fc' : (currentHouse === 'pulsar' ? '#f59e0b' : (currentHouse === 'nebula' ? '#34d399' : '#38bdf8'));
      hctx.save();
      hctx.translate(singX, singY);

      // Gravitational Lensing Halo (Light warping around singularity)
      const lensGrad = hctx.createRadialGradient(0, 0, singR, 0, 0, singR * 3.4);
      lensGrad.addColorStop(0, 'rgba(0,0,0,0.9)');
      lensGrad.addColorStop(0.3, singColor);
      lensGrad.addColorStop(0.7, 'rgba(255, 210, 63, 0.25)');
      lensGrad.addColorStop(1, 'rgba(0,0,0,0)');
      hctx.fillStyle = lensGrad;
      hctx.beginPath();
      hctx.arc(0, 0, singR * 3.4, 0, Math.PI * 2);
      hctx.fill();

      // Relativistic Accretion Disk (Tilted Ellipse)
      hctx.beginPath();
      hctx.ellipse(0, 0, 48, 14, -0.3, 0, Math.PI * 2);
      hctx.strokeStyle = 'rgba(255, 210, 63, 0.75)';
      hctx.lineWidth = 2.4;
      hctx.shadowColor = singColor;
      hctx.shadowBlur = 12;
      hctx.stroke();
      hctx.shadowBlur = 0;

      // Accretion Stream Particles orbiting event horizon
      for (const p of singParticles) {
        p.theta += p.speed;
        const px = Math.cos(p.theta) * p.dist;
        const py = Math.sin(p.theta) * (p.dist * 0.32);
        const rot = -0.3;
        const rx = px * Math.cos(rot) - py * Math.sin(rot);
        const ry = px * Math.sin(rot) + py * Math.cos(rot);
        hctx.beginPath();
        hctx.arc(rx, ry, p.size, 0, Math.PI * 2);
        hctx.fillStyle = p.color;
        hctx.fill();
      }

      // Pitch Black Event Horizon Core (Absolute Void)
      hctx.beginPath();
      hctx.arc(0, 0, singR, 0, Math.PI * 2);
      hctx.fillStyle = '#010206';
      hctx.fill();
      hctx.lineWidth = 2.0;
      hctx.strokeStyle = singColor;
      hctx.stroke();
      hctx.restore();

      // --- 4. Mägic: The Astral Sovereign (HoMM V Archon Masterpiece) ---
      if (mascot.flipProgress > 0) {
        mascot.flipProgress = Math.max(0, mascot.flipProgress - 0.04);
      }
      const hoverY = mascot.baseY + Math.sin(now * 0.003) * 3.8;
      drawAstralArchon(hctx, {
        mascot: currentMascot,
        cx: mascot.baseX,
        cy: hoverY,
        scale: 1.15,
        tilt: 0,
        flipProgress: mascot.flipProgress,
        now,
        house: currentHouse,
        skin: equippedSkin,
        lookX: mascot.lookX,
        lookY: mascot.lookY,
        aiming: false,
        happy: mascot.flipProgress > 0,
        worried: false,
        ballColor: singColor,
        showScepter: true
      });

      // --- 5. Mascot Sparkles Animation ---
      mascotSparkles = mascotSparkles.filter(sp => sp.life > 0);
      for (const sp of mascotSparkles) {
        sp.x += sp.vx;
        sp.y += sp.vy;
        sp.life--;
        const a = sp.life / sp.maxLife;
        hctx.beginPath();
        hctx.arc(sp.x, sp.y, sp.size * a, 0, Math.PI * 2);
        hctx.fillStyle = sp.color;
        hctx.globalAlpha = a;
        hctx.fill();
        hctx.globalAlpha = 1;
      }

      heroStageAnimId = requestAnimationFrame(renderHeroStage);
    }

    if (heroStageAnimId) cancelAnimationFrame(heroStageAnimId);
    heroStageAnimId = requestAnimationFrame(renderHeroStage);
  }

  // --- Initialization & Event Bindings ---
  function init() {
    sizeCanvas();
    initStars();
    initBackgroundParticles();
    updateNextPreview();
    updateStarsUI();
    applyLanguage();
    setGameViewMode('menu');
    renderDifficultyRow();
    renderMissions();
    renderTower();
    updateAchievementsBadge();
    updateMissionsBadge();
    updateDailyBonusUI();
    updateFortuneUI();
    initSettingsModal();
    setRulesTab('basics');
    initHommCitadelInterface();

    // Main Menu Buttons
    bindTap(document.getElementById('endlessBtn'), () => {
      gameMode = 'endless';
      currentPathLevel = -1;
      applyTheme(0);
      startGame();
    });

    bindTap(document.getElementById('pathBtn'), () => {
      renderMapModal();
      openModal('mapModal');
    });

    bindTap(document.getElementById('shopBtn'), () => {
      renderShopModal();
      openModal('shopModal');
    });

    bindTap(document.getElementById('inGameShopBtn'), () => {
      renderShopModal();
      openModal('shopModal');
    });

    bindTap(document.getElementById('upgradesBtn'), () => {
      renderUpgradesModal();
      openModal('upgradesModal');
    });

    bindTap(document.getElementById('missionsBtn'), () => {
      renderMissions();
      openModal('missionsModal');
    });

    bindTap(document.getElementById('towerBtn'), () => {
      renderTower();
      openModal('towerModal');
    });

    bindTap(document.getElementById('achBtn'), () => {
      renderAchievements();
      openModal('achModal');
    });

    bindTap(document.getElementById('helpBtn'), () => {
      setRulesTab('basics');
      openModal('rulesModal');
    });

    bindTap(document.getElementById('dailyChallengeBtn'), () => {
      const seedEl = document.getElementById('dailySeedText');
      if (seedEl) seedEl.textContent = (currentLang === 'ru' ? 'Дата: ' : 'Date: ') + dailyDateKey();
      openModal('dailyModal');
    });

    bindTap(document.getElementById('startDailyBtn'), startDailyChallenge);

    bindTap(document.getElementById('dailyBonusBtn'), () => {
      safeStorage.setItem('mergeTowerDailyClaim', dailyDateKey());
      addStars(8);
      updateDailyBonusUI();
      playStarChime(1);
      floatingTexts.push({ x: W / 2, y: dangerY + 50, text: '+8★', life: 55, maxLife: 55, color: '#ffd23f', size: 18 });
    });

    // Celestial Wheel of Fortune
    bindTap(document.getElementById('fortuneBtn'), () => {
      openModal('fortuneModal');
      updateFortuneUI();
      drawFortuneWheel();
    });

    bindTap(document.getElementById('fortuneCloseBtn'), () => {
      closeModal('fortuneModal');
    });

    bindTap(document.getElementById('fortuneSpinBtn'), () => {
      triggerFortuneSpin();
    });

    // Emergency Rescue Second Chance
    bindTap(document.getElementById('rescueActionBtn'), () => {
      triggerRescueWithAd();
    });

    bindTap(document.getElementById('rescueSkipBtn'), () => {
      if (rescueCountdownTimer) {
        clearInterval(rescueCountdownTimer);
        rescueCountdownTimer = null;
      }
      closeModal('rescueModal');
      showGameOver();
    });

    bindTap(document.getElementById('cloudBtn'), async () => {
      await requestYandexAuthorization();
    });
    bindTap(document.getElementById('settingsCloudBtn'), async () => {
      await requestYandexAuthorization();
    });

    bindTap(document.getElementById('leaderboardBtn'), async () => {
      const ok = await requestYandexAuthorization();
      if (ok) await submitYandexLeaderboard(best);
    });

    // In-game Top Bar & Controls
    bindTap(document.getElementById('settingsBtn'), () => {
      openModal('optionsModal');
    });

    bindTap(document.getElementById('optResumeBtn') || document.getElementById('optionsResumeBtn'), () => {
      closeModal('optionsModal');
    });

    bindTap(document.getElementById('optRestartBtn'), () => {
      closeModal('optionsModal');
      if (gameMode === 'path' && currentPathLevel >= 0) startPathLevel(currentPathLevel);
      else if (gameMode === 'daily') startDailyChallenge();
      else startGame();
    });

    bindTap(document.getElementById('optUpgradesBtn'), () => {
      renderUpgradesModal();
      openModal('upgradesModal');
    });

    bindTap(document.getElementById('optSettingsBtn') || document.getElementById('optionsSettingsBtn'), () => {
      openModal('settingsModal');
    });

    bindTap(document.getElementById('optHelpBtn') || document.getElementById('optionsRulesBtn'), () => {
      setRulesTab('basics');
      openModal('helpModal');
    });

    bindTap(document.getElementById('optionsSoundToggleBtn'), () => {
      setMusicEnabled(!musicEnabled);
    });

    bindTap(document.getElementById('optionsMapBtn'), () => {
      renderMapModal();
      openModal('mapModal');
    });

    bindTap(document.getElementById('optExitBtn') || document.getElementById('optionsQuitBtn'), () => {
      openModal('quitWarningModal');
    });

    bindTap(document.getElementById('quitCancelBtn'), () => {
      closeModal('quitWarningModal');
      openModal('optionsModal');
    });

    bindTap(document.getElementById('quitConfirmBtn'), () => {
      showMainMenu();
    });

    // Rules Tabs
    document.querySelectorAll('.rules-tab-btn').forEach(btn => {
      bindTap(btn, () => {
        setRulesTab(btn.dataset.tab);
      });
    });

    // Game Over Actions
    bindTap(document.getElementById('goRestartBtn'), () => {
      closeModal('gameOverModal');
      if (gameMode === 'path' && currentPathLevel >= 0) startPathLevel(currentPathLevel);
      else if (gameMode === 'daily') startDailyChallenge();
      else startGame();
    });

    bindTap(document.getElementById('goMapBtn'), () => {
      closeModal('gameOverModal');
      renderMapModal();
      openModal('mapModal');
    });

    bindTap(document.getElementById('rewardAdBtn') || document.getElementById('goReviveAdBtn'), () => {
      showRewardedStars();
    });

    bindTap(document.getElementById('goHomeBtn') || document.getElementById('goQuitBtn'), () => {
      showMainMenu();
    });

    // Level Complete Actions
    bindTap(document.getElementById('compNextBtn'), () => {
      closeModal('completeModal');
      if ((currentPathLevel + 1) % 3 === 0) showYandexFullscreenAd();
      startPathLevel(currentPathLevel + 1);
    });

    bindTap(document.getElementById('compRestartBtn'), () => {
      closeModal('completeModal');
      startPathLevel(currentPathLevel);
    });

    bindTap(document.getElementById('compMapBtn'), () => {
      closeModal('completeModal');
      renderMapModal();
      openModal('mapModal');
    });

    bindTap(document.getElementById('compHomeBtn'), () => {
      showMainMenu();
    });

    // Additional Modal Controls & OK Buttons
    bindTap(document.getElementById('helpOkBtn'), () => {
      closeModal('helpModal');
    });

    bindTap(document.getElementById('upgradesOkBtn'), () => {
      closeModal('upgradesModal');
    });

    bindTap(document.getElementById('settingsOkBtn'), () => {
      closeModal('settingsModal');
    });

    bindTap(document.getElementById('achOkBtn'), () => {
      closeModal('achModal');
    });

    bindTap(document.getElementById('optionsCloseBtn'), () => {
      closeModal('optionsModal');
    });

    bindTap(document.getElementById('quitWarningCloseBtn'), () => {
      closeModal('quitWarningModal');
      openModal('optionsModal');
    });

    bindTap(document.getElementById('settingsCloseBtn'), () => {
      closeModal('settingsModal');
    });

    bindTap(document.getElementById('upgradesCloseBtn'), () => {
      closeModal('upgradesModal');
    });

    bindTap(document.getElementById('mapCloseBtn'), () => {
      closeModal('mapModal');
    });

    bindTap(document.getElementById('helpCloseBtn'), () => {
      closeModal('helpModal');
    });

    bindTap(document.getElementById('shopCloseBtn'), () => {
      closeModal('shopModal');
    });

    bindTap(document.getElementById('achCloseBtn'), () => {
      closeModal('achModal');
    });

    bindTap(document.getElementById('mapHomeBtn'), () => {
      showMainMenu();
    });

    bindTap(document.getElementById('shopHomeBtn'), () => {
      showMainMenu();
    });

    bindTap(document.getElementById('shopBackBtn'), () => {
      closeModal('shopModal');
      if (!running) showMainMenu();
    });

    bindTap(document.getElementById('shopSettingsBtn'), () => {
      openModal('settingsModal');
    });

    bindTap(document.getElementById('backFromDailyBtn'), () => {
      closeModal('dailyOverlay');
      if (!running) showMainMenu();
    });

    bindTap(document.getElementById('backFromMissionsBtn'), () => {
      closeModal('missionsOverlay');
      if (!running) showMainMenu();
    });

    bindTap(document.getElementById('backFromTowerBtn'), () => {
      closeModal('towerOverlay');
      if (!running) showMainMenu();
    });

    // Shop Ad Reward
    bindTap(document.getElementById('shopRewardStarsBtn'), () => {
      showRewardedStars();
      setTimeout(renderShopModal, 300);
    });

    // Language switchers
    bindTap(document.getElementById('langRuBtn'), () => setLanguage('ru'));
    bindTap(document.getElementById('langEnBtn'), () => setLanguage('en'));

    // In-game tools & Nudge
    bindTap(document.getElementById('nudgeBtn'), useNudge);
    bindTap(document.getElementById('shrinkBtn'), () => toggleToolSelect('shrink'));
    bindTap(document.getElementById('bombBtn'), () => toggleToolSelect('bomb'));
    bindTap(document.getElementById('swapBtn'), useSwap);

    // Modal Close buttons (generic fallback for any other close buttons)
    document.querySelectorAll('.cosmic-modal-close, .modal-close-btn').forEach(btn => {
      bindTap(btn, () => {
        const wrap = btn.closest('.cosmic-modal-wrap, .master-overlay');
        if (wrap && wrap.id) closeModal(wrap.id);
        else closeAllModals();
      });
    });

    // Backdrop tap closes modal
    document.querySelectorAll('.cosmic-modal-wrap, .master-overlay').forEach(wrap => {
      bindTap(wrap, e => {
        if (e.target === wrap) {
          closeModal(wrap.id);
        }
      });
    });

    let wasRunningBeforeHide = false;
    window.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (running) {
          wasRunningBeforeHide = true;
          running = false;
          try { ysdk?.features?.GameplayAPI?.stop?.(); } catch(e){}
        }
        saveEndlessInProgress();
        queueCloudSave(true);
      } else {
        if (wasRunningBeforeHide && !gameOver && !goalAchieved) {
          wasRunningBeforeHide = false;
          running = true;
          lastLoopTime = performance.now();
          try { ysdk?.features?.GameplayAPI?.start?.(); } catch(e){}
          if (!currentBall && !spawnTimeoutId) spawnCurrent();
        }
      }
    });

    requestAnimationFrame(loop);
    initYandexPlatform();
  }

  init();
})();
