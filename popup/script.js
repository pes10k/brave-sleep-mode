window.addEventListener("DOMContentLoaded", () => {
  let curState = true;
  setInterval(() => {
    const pElms = document.getElementsByTagName("p");
    for (const anElm of Array.from(pElms)) {
      anElm.textContent = curState ? "state on" : "state off";
    }
    curState = !curState;
  }, 1000);
});

