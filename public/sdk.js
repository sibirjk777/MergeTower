/**
 * Yandex Games SDK local mock / fallback.
 * Allows full local preview, testing of Cloud Saves, Leaderboards, GameplayAPI,
 * and Rewarded/Fullscreen Ads without network errors when running outside yandex.ru.
 */
(function () {
  if (typeof window.YaGames !== 'undefined') return;

  const mockStorage = {};

  window.YaGames = {
    init: async function () {
      console.info('[YaGames Mock] SDK initialized in local/preview mode');
      return {
        environment: {
          app: { id: 'merge_tower' },
          browser: { lang: navigator.language ? navigator.language.slice(0, 2) : 'ru' },
          i18n: { lang: 'ru', t: (k) => k },
        },
        features: {
          LoadingAPI: {
            ready: function () {
              console.info('[YaGames Mock] LoadingAPI.ready()');
            },
          },
          GameplayAPI: {
            start: function () {
              console.info('[YaGames Mock] GameplayAPI.start()');
            },
            stop: function () {
              console.info('[YaGames Mock] GameplayAPI.stop()');
            },
          },
        },
        auth: {
          openAuthDialog: async function () {
            console.info('[YaGames Mock] openAuthDialog');
            return true;
          },
        },
        getPlayer: async function () {
          return {
            isAuthorized: () => true,
            getName: () => 'Игрок',
            getPhoto: () => '',
            getUniqueID: () => 'mock_player_123',
            getData: async function (keys) {
              const res = {};
              (keys || []).forEach((k) => {
                try {
                  const val = localStorage.getItem('yagames_mock_' + k);
                  if (val) res[k] = JSON.parse(val);
                } catch (e) {
                  res[k] = mockStorage[k] || null;
                }
              });
              return res;
            },
            setData: async function (data, flush) {
              Object.keys(data || {}).forEach((k) => {
                mockStorage[k] = data[k];
                try {
                  localStorage.setItem('yagames_mock_' + k, JSON.stringify(data[k]));
                } catch (e) {}
              });
              return true;
            },
          };
        },
        leaderboards: {
          setScore: async function (name, score) {
            console.info(`[YaGames Mock] setScore on ${name}: ${score}`);
            try {
              localStorage.setItem('yagames_lb_' + name, String(score));
            } catch (e) {}
            return true;
          },
          getLeaderboardPlayerEntry: async function (name) {
            const s = localStorage.getItem('yagames_lb_' + name) || '0';
            return { score: parseInt(s, 10), rank: 1 };
          },
        },
        isAvailableMethod: async function () {
          return true;
        },
        adv: {
          showFullscreenAdv: function (options) {
            console.info('[YaGames Mock] showFullscreenAdv called');
            if (options && options.callbacks) {
              if (options.callbacks.onOpen) options.callbacks.onOpen();
              setTimeout(() => {
                if (options.callbacks.onClose) options.callbacks.onClose(true);
              }, 400);
            }
          },
          showRewardedVideo: function (options) {
            console.info('[YaGames Mock] showRewardedVideo called');
            if (options && options.callbacks) {
              if (options.callbacks.onOpen) options.callbacks.onOpen();
              setTimeout(() => {
                if (options.callbacks.onRewarded) options.callbacks.onRewarded();
                if (options.callbacks.onClose) options.callbacks.onClose();
              }, 600);
            }
          },
        },
      };
    },
  };
})();
