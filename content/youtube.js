console.log("content: START");

const CONSTS = {
  CSS_CLASS_ASLEEP: "asleep",
  TEXT_ACTIVE: "Wake",
  TEXT_NOT_ACTIVE: "Sleep"
};

const PAGE_STATES = {
  INIT: 1,
  NEVER_APPLIED: 2,
  APPLIED: 3
};

const UPDATE_REASONS = {
  QUEUE_CHANGED: "Queued Videos Changed",
  URL_CHANGED: "URL Changed"
};
const UPDATE_REASON_VALUES = new Set(Array.from(Object.values(UPDATE_REASONS)));

// Default values for options are as follows:
//
// options = {
//     removeHigh: true,
//     removeLow: true,
//     compress: true
// }
const modifyAudioOnClick = (function () {
  let audioContext;
  return (videoElm, options) => {
    const doCompression = options?.compress ?? true;
    const doRemoveHigh = options?.removeHigh ?? true;
    const doRemoveLow = options?.removeLow ?? true;
    const filters = [];

    if (audioContext === undefined) {
      audioContext = new window.AudioContext();
    }

    if (audioContext.state === "suspended") {
      audioContext.resume();
    }

    const sourceNode = audioContext.createMediaElementSource(videoElm);

    if (doCompression === true) {
      const compressorNode = audioContext.createDynamicsCompressor();
      // Lower threshold catches loud sounds sooner (-25dB to -35dB
      // is ideal for movies/actions)
      compressorNode.threshold.setValueAtTime(-30, audioContext.currentTime);

      // Smooth transition into compression (higher value = smoother blend)
      compressorNode.knee.setValueAtTime(20, audioContext.currentTime);

      // High ratio ensures loud sounds are significantly clamped down
      compressorNode.ratio.setValueAtTime(15, audioContext.currentTime);

      // Near-instant attack time (0.001s) clamp down on sudden
      // explosions instantly
      compressorNode.attack.setValueAtTime(0.001, audioContext.currentTime);

      // Fast release (0.1s) ensures normal dialogue volume returns quickly
      // after the noise stops
      compressorNode.release.setValueAtTime(0.1, audioContext.currentTime);
      filters.push(compressorNode);

      // Also create a gain node to reduce the volume slightly, to account for
      // the perceived volume increase added from the compression.
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0.8;
      filters.push(gainNode);
    }

    if (doRemoveHigh === true) {
      // Human speech is usually well under 3000-4000 Hz. Whistles, screeching,
      // and high hiss live above this line. Adjust this number to fit your
      // specific needs.
      const highFilterNode = audioContext.createBiquadFilter();
      highFilterNode.type = "lowpass";
      highFilterNode.frequency.value = 3000;
      highFilterNode.Q.value = 1;
      filters.push(highFilterNode);
    }

    if (doRemoveLow === true) {
      // Sub-bass rumble lives below 80 Hz. Hum and thumps live below 200 Hz.
      // Adjust this value based on your specific noise issue.
      const lowFilterNode = audioContext.createBiquadFilter();
      lowFilterNode.type = "highpass";
      lowFilterNode.frequency.value = 150;
      lowFilterNode.Q.value = 1;
      filters.push(lowFilterNode);
    }

    if (filters.length === 0) {
      throw new Error("No specified audio modifications.");
    }

    let prevNode = sourceNode;
    for (let i = 0; i < filters.length; i += 1) {
      prevNode.connect(filters[i]);
      prevNode = filters[i];
    }
    prevNode.connect(audioContext.destination);

    return {
      stop: () => {
        sourceNode.disconnect(filters[0]);
        filters[filters.length - 1].disconnect(audioContext.destination);
        sourceNode.connect(audioContext.destination);
        audioContext = undefined;
      }
    };
  };
}());

const currentVideoTitle = () => { // string | undefined
  const elm = document.querySelector("#title h1");
  return elm?.textContent.trim();
};

const queuedVideoTitles = () => { // string[] | null
  const playlistElm = document.getElementById("playlist");
  if (playlistElm === null) {
    return null;
  }

  const titleElms = playlistElm.querySelectorAll("h4 #video-title");
  return Array.from(titleElms).map((x) => x.textContent.trim());
};

const mainVideoElm = () => { // Element | null
  return document.querySelector("video.video-stream.html5-main-video");
};

const getPageState = () => {
  const currentTitle = currentVideoTitle();
  const videoElm = mainVideoElm();
  const videoSrc = videoElm && videoElm.src;
  const queuedVideos = queuedVideoTitles();

  return {
    queueTitles: queuedVideos,
    title: currentTitle,
    videoElm,
    videoSrc
  };
};

const updateBackgroundPage = (reason) => {
  if (UPDATE_REASON_VALUES.has(reason) === false) {
    throw new Error("Tried to update the background page with unknown reason");
  }

  const pageState = getPageState();
  console.log(`Updating: Reason=${reason}`, pageState);

  chrome.runtime.sendMessage({
    event: reason,
    state: pageState
  });
};

const areSetsDiff = (setA, setB) => { // bool
  if (setA === null && setB === null) {
    return false;
  }
  // I am sure there is a nicer way of doing this, but...
  if (setA === null && setB !== null) {
    return true;
  }
  if (setA !== null && setB === null) {
    return true;
  }

  // Otherwise, they're both sets, and we know the sets are the same if the
  // size of the union set is the same as the size of either starting set.
  // If the size of the union is the same as the size of a starting set,
  // then there are no changes.
  if (setA.intersection(setB).size === setA.size) {
    return false;
  }

  return true;
};

const updateIfNeeded = (function () {
  let prevUrl = null; // null | string
  let prevTitlesSet = null; // null | Set<string>

  return () => {
    const newUrl = document.location.toString();

    if (newUrl !== prevUrl) {
      prevUrl = newUrl;
      updateBackgroundPage(UPDATE_REASONS.URL_CHANGED);
      return true;
    }

    const queueTitlesArray = queuedVideoTitles();
    const queueTitlesSet = queueTitlesArray && new Set(queueTitlesArray);
    if (areSetsDiff(queueTitlesSet, prevTitlesSet)) {
      prevTitlesSet = queueTitlesSet;
      updateBackgroundPage(UPDATE_REASONS.QUEUE_CHANGED);
      return true;
    }

    return false;
  };
}());

const createTimeInput = () => {
  const middleRowElm = document.getElementById("middle-row");
  const fieldsetElm = document.createElement("fieldset");
  const inputElm = document.createElement("input");

  inputElm.style.width = "20em";
  inputElm.style.float = "right";
  inputElm.setAttribute("type", "text");
  inputElm.setAttribute("placeholder", "Input advance time as HH:MM:SS");
  inputElm.setAttribute("id", "brave-advance-time");

  fieldsetElm.appendChild(inputElm);
  middleRowElm.appendChild(fieldsetElm);

  return inputElm;
};

const goToNextQueuedVideo = () => {
  const pageState = getPageState();
  const currentIndex = pageState.queueTitles.indexOf(pageState.title);

  const queuedVideos = document.querySelectorAll("#playlist h4 #video-title");
  if (queuedVideos[currentIndex + 1] === undefined) {
    return;
  }
  queuedVideos[currentIndex + 1].click();
};

const secondsForInput = (hoursMinutesSecsString) => { // bool | number
  const parts = hoursMinutesSecsString.split(":");
  if (parts.length !== 3) {
    return false;
  }

  let totalSeconds = 0;

  const hourValue = parseInt(parts[0], 10);
  if (hourValue === NaN) {
    return false;
  }
  totalSeconds += (hourValue * 60 * 60);

  const minuteValue = parseInt(parts[1], 10);
  if (minuteValue === NaN) {
    return false;
  }
  totalSeconds += (minuteValue * 60);

  const secsValue = parseInt(parts[2], 10);
  if (secsValue === NaN) {
    return false;
  }
  totalSeconds += secsValue;

  return totalSeconds;
};

const startCheckingForAutoAdvance = (inputElm, videoElm) => {
  setInterval(() => {
    const skipAtTime = secondsForInput(inputElm.value);
    if (skipAtTime === false) {
      return;
    }
    const currentTime = videoElm.currentTime;

    if (currentTime >= skipAtTime) {
      goToNextQueuedVideo();
    }
  }, 500);
};

const createSleepModeButton = () => { // Promise
  const getAskButton = () => { // Element | null
    return document.querySelector(
      "#flexible-item-buttons .you-chat-entrypoint-button"
    );
  };

  return new Promise((resolve) => {
    let timerId;
    timerId = setInterval(() => {
      const askButtonElm = getAskButton();
      if (askButtonElm === null) {
        return;
      }

      clearInterval(timerId);
      const askWidgetElm = askButtonElm.parentNode;

      const sleepSpan = document.createElement("span");
      sleepSpan.textContent = CONSTS.TEXT_NOT_ACTIVE;

      const sleepWidgetElm = askWidgetElm.cloneNode(true);
      const sleepModeBtnElm = sleepWidgetElm.querySelector("button");

      sleepModeBtnElm.setAttribute("id", "brave-sleep-mode-btn");
      sleepModeBtnElm.textContent = "";
      sleepModeBtnElm.appendChild(sleepSpan);

      askWidgetElm.parentElement.appendChild(sleepWidgetElm);
      askWidgetElm.parentElement.removeChild(askWidgetElm);

      let currentState = PAGE_STATES.INIT;
      sleepWidgetElm.addEventListener("click", () => {
        console.log("Sleep: Clicked");

        if (currentState === PAGE_STATES.INIT) {
          const pageState = getPageState();
          modifyAudioOnClick(pageState.videoElm, {
            compress: true,
            removeHigh: true,
            removeLow: true,
          });
          sleepSpan.innerText = CONSTS.TEXT_ACTIVE;
          sleepModeBtnElm.classList.add(CONSTS.CSS_CLASS_ASLEEP);
          console.log("Sleep mode active.");
          currentState = PAGE_STATES.APPLIED;

          const inputElm = createTimeInput();
          startCheckingForAutoAdvance(inputElm, pageState.videoElm);
          return;
        }

        if (currentState === PAGE_STATES.APPLIED) {
          console.log("Reloading page.");
          window.location = window.location.toString();
          return;
        }
      }, false);

      resolve(true);
    }, 1000);
  });
};

window.addEventListener("DOMContentLoaded", async () => {
  // setInterval(updateIfNeeded, 1000);
  console.log("content: start");
  await createSleepModeButton();
  console.log("content: finish");
});

console.log("content: END");
