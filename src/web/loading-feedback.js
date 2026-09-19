(() => {
  // Keep the progress slot in the layout, but skip feedback for short local reads.
  window.createLoadingFeedback = (element, delayMs = 200) => {
    let busy = false, timer;
    element.hidden = false;
    element.style.visibility = 'hidden';
    element.style.opacity = '0';
    return value => {
      if (busy === value) return;
      busy = value;
      clearTimeout(timer);
      if (value) timer = setTimeout(() => { element.style.visibility = 'visible'; element.style.opacity = '1'; }, delayMs);
      else { element.style.visibility = 'hidden'; element.style.opacity = '0'; }
    };
  };
})();
