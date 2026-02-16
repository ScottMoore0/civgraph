(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.ElectionAnimationPreviewManager = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function createManager(options) {
    const config = options || {};
    const startAnimation = config.startAnimation;
    const resolveElection = config.resolveElection;
    const updateToggle = typeof config.updateToggle === 'function' ? config.updateToggle : () => {};
    const onError = typeof config.onError === 'function'
      ? config.onError
      : (err) => {
          if (typeof console !== 'undefined' && console && typeof console.error === 'function') {
            console.error(err);
          }
        };

    if (typeof startAnimation !== 'function') {
      throw new Error('startAnimation must be provided');
    }
    if (typeof resolveElection !== 'function') {
      throw new Error('resolveElection must be provided');
    }

    const dataKey = '__animationPreviewData';

    function getData(container) {
      if (!container) return null;
      let data = container[dataKey];
      if (!data) {
        data = {
          clones: null,
          triggerCleanup: [],
          stopCleanup: null,
          toggleState: null,
          isActive: false,
          restoring: false,
        };
        container[dataKey] = data;
      }
      return data;
    }

    function captureClones(container, data) {
      if (!container || !data) return;
      if (data.clones && data.clones.length) return;
      const nodes = Array.from(container.childNodes || []);
      data.clones = nodes.map((node) => (typeof node.cloneNode === 'function' ? node.cloneNode(true) : node));
    }

    function cleanupTriggerHandlers(data) {
      if (!data || !Array.isArray(data.triggerCleanup)) return;
      data.triggerCleanup.forEach((fn) => {
        try {
          if (typeof fn === 'function') fn();
        } catch (err) {
          // Ignore cleanup errors.
        }
      });
      data.triggerCleanup = [];
    }

    function cleanupStopListener(data) {
      if (!data) return;
      if (typeof data.stopCleanup === 'function') {
        try {
          data.stopCleanup();
        } catch (err) {
          // Ignore cleanup errors.
        }
      }
      data.stopCleanup = null;
    }

    function restorePreview(container, data) {
      if (!container || !data || data.restoring) return;
      data.restoring = true;
      cleanupTriggerHandlers(data);
      cleanupStopListener(data);
      if (typeof container.innerHTML === 'string') {
        try {
          container.innerHTML = '';
        } catch (err) {
          while (container.firstChild) {
            container.removeChild(container.firstChild);
          }
        }
      } else {
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }
      }
      if (Array.isArray(data.clones) && data.clones.length) {
        data.clones.forEach((node) => {
          const clone = typeof node.cloneNode === 'function' ? node.cloneNode(true) : node;
          if (typeof container.appendChild === 'function') {
            container.appendChild(clone);
          }
        });
        if (container.classList && typeof container.classList.add === 'function') {
          container.classList.add('has-preview');
        }
        if ('hidden' in container) {
          container.hidden = false;
        }
        const index = Number(container?.dataset?.animationFor);
        if (Number.isFinite(index)) {
          registerPreview(container, data, index);
        }
      } else if ('hidden' in container) {
        container.hidden = true;
      }
      data.isActive = false;
      data.restoring = false;
    }

    function registerPreview(container, data, index) {
      if (!container || !data) return;
      cleanupTriggerHandlers(data);
      const triggers = typeof container.querySelectorAll === 'function'
        ? Array.from(container.querySelectorAll('[data-animation-preview]') || [])
        : [];
      if (!triggers.length) {
        return;
      }
      triggers.forEach((trigger) => {
        if (!trigger) return;
        if (trigger.dataset && trigger.dataset.previewInit === '1') return;
        if (trigger.dataset) {
          trigger.dataset.previewInit = '1';
        }
        const activate = (evt) => {
          if (evt && typeof evt.preventDefault === 'function') {
            evt.preventDefault();
          }
          startFromPreview(container, index);
        };
        const keyHandler = (evt) => {
          if (!evt) return;
          const key = evt.key || evt.keyCode;
          if (key === 'Enter' || key === 13 || key === ' ' || key === 'Spacebar') {
            if (typeof evt.preventDefault === 'function') evt.preventDefault();
            activate(evt);
          }
        };
        if (typeof trigger.addEventListener === 'function') {
          trigger.addEventListener('click', activate);
          trigger.addEventListener('keydown', keyHandler);
          data.triggerCleanup.push(() => {
            if (typeof trigger.removeEventListener === 'function') {
              trigger.removeEventListener('click', activate);
              trigger.removeEventListener('keydown', keyHandler);
            }
            if (trigger.dataset) {
              delete trigger.dataset.previewInit;
            }
          });
        }
      });
      if (container.classList && typeof container.classList.add === 'function') {
        container.classList.add('has-preview');
      }
      if ('hidden' in container) {
        container.hidden = false;
      }
    }

    function attachStopListener(container, data, index) {
      cleanupStopListener(data);
      if (!container || typeof container.addEventListener !== 'function') {
        return;
      }
      const handler = () => {
        if (!data.isActive) {
          cleanupStopListener(data);
          return;
        }
        data.isActive = false;
        const toggleMeta = data.toggleState;
        if (toggleMeta && Number.isFinite(toggleMeta.index)) {
          if (toggleMeta.startedNotified) {
            updateToggle(toggleMeta.index, false);
          } else {
            toggleMeta.stopQueued = true;
          }
        } else if (Number.isFinite(index)) {
          updateToggle(index, false);
        }
        restorePreview(container, data);
      };
      container.addEventListener('election-animation:stopped', handler);
      data.stopCleanup = () => {
        if (typeof container.removeEventListener === 'function') {
          container.removeEventListener('election-animation:stopped', handler);
        }
      };
    }

    async function activate(container, data, index, election) {
      if (!container || !data) return false;
      captureClones(container, data);
      cleanupTriggerHandlers(data);
      if (typeof container.innerHTML === 'string') {
        try {
          container.innerHTML = '';
        } catch (err) {
          while (container.firstChild) {
            container.removeChild(container.firstChild);
          }
        }
      } else {
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }
      }
      if (container.classList && typeof container.classList.remove === 'function') {
        container.classList.remove('has-preview');
      }
      if ('hidden' in container) {
        container.hidden = false;
      }

      let startError = null;
      let startResult;
      try {
        startResult = startAnimation(container, election, index);
      } catch (err) {
        startError = err;
        startResult = false;
      }

      data.isActive = true;
      if (Number.isFinite(index)) {
        data.toggleState = {
          index,
          startedNotified: false,
          stopQueued: false,
        };
      } else {
        data.toggleState = null;
      }
      attachStopListener(container, data, index);

      const isPromise = startResult && typeof startResult.then === 'function';
      if (!isPromise) {
        const started = startResult !== false;
        if (!started) {
          data.isActive = false;
          const toggleMeta = data.toggleState;
          if (toggleMeta && Number.isFinite(toggleMeta.index)) {
            if (!toggleMeta.stopQueued) {
              updateToggle(toggleMeta.index, false);
            }
          } else if (Number.isFinite(index)) {
            updateToggle(index, false);
          }
          data.toggleState = null;
          if (startError) {
            onError(startError);
          }
          restorePreview(container, data);
          return false;
        }

        const toggleMeta = data.toggleState;
        if (toggleMeta && Number.isFinite(toggleMeta.index)) {
          updateToggle(toggleMeta.index, true);
          toggleMeta.startedNotified = true;
          if (toggleMeta.stopQueued) {
            updateToggle(toggleMeta.index, false);
            toggleMeta.stopQueued = false;
          }
        } else if (Number.isFinite(index)) {
          updateToggle(index, true);
        }
        return true;
      }

      let resolvedValue;
      try {
        resolvedValue = await Promise.resolve(startResult);
      } catch (err) {
        startError = err;
        resolvedValue = false;
      }

      const started = resolvedValue !== false;
      if (!started) {
        data.isActive = false;
        const toggleMeta = data.toggleState;
        if (toggleMeta && Number.isFinite(toggleMeta.index)) {
          if (!toggleMeta.stopQueued) {
            updateToggle(toggleMeta.index, false);
          }
        } else if (Number.isFinite(index)) {
          updateToggle(index, false);
        }
        data.toggleState = null;
        if (startError) {
          onError(startError);
        }
        restorePreview(container, data);
        return false;
      }

      const toggleMeta = data.toggleState;
      if (toggleMeta && Number.isFinite(toggleMeta.index)) {
        updateToggle(toggleMeta.index, true);
        toggleMeta.startedNotified = true;
        if (toggleMeta.stopQueued) {
          updateToggle(toggleMeta.index, false);
          toggleMeta.stopQueued = false;
        }
      } else if (Number.isFinite(index)) {
        updateToggle(index, true);
      }
      return true;
    }

    async function startFromPreview(container, index) {
      const data = getData(container);
      if (!data) return false;
      const election = resolveElection(index);
      if (!election) {
        restorePreview(container, data);
        return false;
      }
      return activate(container, data, index, election);
    }

    function initialize(root) {
      const scope = root || (typeof document !== 'undefined' ? document : null);
      if (!scope || typeof scope.querySelectorAll !== 'function') return;
      const wrappers = Array.from(scope.querySelectorAll('.election-animation-wrapper') || []);
      wrappers.forEach((wrapper) => {
        const index = Number(wrapper?.dataset?.animationFor);
        if (!Number.isFinite(index)) return;
        const data = getData(wrapper);
        captureClones(wrapper, data);
        if (data.isActive) return;
        registerPreview(wrapper, data, index);
      });
    }

    async function startFromToggle(container, index, election) {
      const data = getData(container);
      if (!data) return false;
      const payload = election || resolveElection(index);
      if (!payload) {
        restorePreview(container, data);
        return false;
      }
      return activate(container, data, index, payload);
    }

    function handleStopped(container) {
      const data = getData(container);
      if (!data) return;
      restorePreview(container, data);
    }

    return {
      initialize,
      startFromToggle,
      handleStopped,
      restorePreview: (container) => {
        const data = getData(container);
        if (data) {
          restorePreview(container, data);
        }
      },
      startFromPreview,
    };
  }

  return { createManager };
});
