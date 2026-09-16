(() => {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function targetIndex(index, count, width, delta, velocity) {
    const commit = Math.abs(delta) >= width * .3 || (Math.abs(delta) >= 24 && Math.abs(velocity) >= .5);
    return clamp(index + (commit ? (delta < 0 ? 1 : -1) : 0), 0, count - 1);
  }
  window.TabPagerMotion = {targetIndex};

  window.createTabPager = ({host, tabs, pages, initialPage, renderPage, onSelect, isBusy}) => {
    const main = host.closest('main');
    document.documentElement.classList.add('has-tab-pager');document.body.classList.add('has-tab-pager');
    main.classList.add('pager-layout');
    host.classList.add('tab-pager');
    const track = document.createElement('div');
    track.className = 'tab-pager-track';
    const roots = [], panes = [], valid = pages.map(() => false), positions = pages.map(() => 0);
    let active = Math.max(0, pages.indexOf(initialPage)), gesture = null, animation = 0, idle = 0, painting = 0;
    let suppressClickUntil = 0, moving = false, pendingRefresh = false;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    for (const [index, page] of pages.entries()) {
      const pane = document.createElement('section');
      pane.className = 'tab-page';pane.id = `tab-panel-${index}`;
      pane.dataset.pagerIndex = String(index);pane.setAttribute('role', 'tabpanel');pane.setAttribute('aria-label', page);
      const root = document.createElement('div');root.className = 'page-content';
      pane.appendChild(root);track.appendChild(pane);panes.push(pane);roots.push(root);
      pane.addEventListener('scroll', () => {if (valid[index]) positions[index] = pane.scrollTop;}, {passive:true});
    }
    host.replaceChildren(track);
    const width = () => Math.max(1, track.getBoundingClientRect().width);
    const buttons = () => [...tabs.querySelectorAll('button')];
    function paint() {
      painting = 0;
      const items = buttons();if (!items.length) return;
      let indicator = tabs.querySelector('.tab-pager-indicator');
      if (!indicator) {indicator = document.createElement('span');indicator.className = 'tab-pager-indicator';indicator.setAttribute('aria-hidden','true');tabs.appendChild(indicator);}
      const position = clamp(track.scrollLeft / width(), 0, pages.length - 1), left = Math.floor(position), right = Math.min(left + 1, pages.length - 1), fraction = position - left;
      const a = items[left], b = items[right];
      if (a && b) {
        indicator.style.width = `${a.offsetWidth + (b.offsetWidth - a.offsetWidth) * fraction}px`;
        indicator.style.transform = `translateX(${a.offsetLeft + (b.offsetLeft - a.offsetLeft) * fraction}px)`;
      }
      items.forEach((button,index) => {
        button.classList.toggle('active', index === Math.round(position));
        button.setAttribute('role','tab');button.setAttribute('aria-controls',panes[index].id);
        button.setAttribute('aria-selected',String(index === active));button.tabIndex = index === active ? 0 : -1;
      });
    }
    const schedulePaint = () => {if (!painting) painting = requestAnimationFrame(paint);};
    function mount(index) {
      if (index < 0 || index >= pages.length || valid[index]) return;
      valid[index] = true;
      try {renderPage(pages[index], roots[index]);} catch (error) {valid[index] = false;throw error;}
      panes[index].scrollTop = positions[index];
    }
    function neighbors() {
      cancelAnimationFrame(idle);
      idle = requestAnimationFrame(() => {mount(active - 1);mount(active + 1);});
    }
    function settle(index, focus = false) {
      moving = false;track.classList.remove('dragging');
      const changed = active !== index;active = index;track.scrollLeft = index * width();
      host.dataset.activePage = pages[index];host.dataset.moving = 'false';
      panes.forEach((pane,i) => {
        pane.classList.toggle('is-active', i === index);pane.inert = i !== index;pane.setAttribute('aria-hidden',String(i !== index));
        if (Math.abs(i - index) > 1) {positions[i] = pane.scrollTop;roots[i].replaceChildren();valid[i] = false;}
      });
      if (changed) onSelect(pages[index], roots[index]);
      if (pendingRefresh) {
        pendingRefresh = false;positions[active] = panes[active].scrollTop;valid.fill(false);mount(active);
      }
      paint();neighbors();
      const selected = buttons()[index];
      selected?.scrollIntoView({block:'nearest',inline:'nearest',behavior:reducedMotion.matches?'auto':'smooth'});
      if (focus) selected?.focus({preventScroll:true});
    }
    function goTo(page, focus = false, finishGesture = false) {
      const index = typeof page === 'number' ? page : pages.indexOf(page);
      if (index < 0 || index >= pages.length || (isBusy() && !finishGesture)) return;
      cancelAnimationFrame(animation);gesture = null;
      for (let i = Math.min(active,index); i <= Math.max(active,index); i++) mount(i);
      const from = track.scrollLeft, to = index * width(), distance = to - from;
      if (Math.abs(distance) < 1 || reducedMotion.matches) {settle(index,focus);return;}
      moving = true;host.dataset.moving = 'true';
      const duration = Math.min(520,240 + Math.abs(distance / width()) * 70), start = performance.now();
      const frame = now => {
        const t = Math.min(1,(now - start) / duration), eased = 1 - Math.pow(1 - t,3);
        track.scrollLeft = from + distance * eased;paint();
        if (t < 1) animation = requestAnimationFrame(frame);else settle(index,focus);
      };
      animation = requestAnimationFrame(frame);
    }
    function excluded(target) {
      if (document.querySelector('dialog[open]') || target.closest('input,textarea,select,[contenteditable="true"]')) return true;
      for (let node = target; node && node !== track; node = node.parentElement) {
        if (node.scrollWidth > node.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(node).overflowX)) return true;
      }
      return false;
    }
    track.addEventListener('touchstart', event => {
      if (isBusy() || moving || event.touches.length !== 1 || excluded(event.target)) {gesture = null;return;}
      const touch = event.touches[0], now = performance.now();
      gesture = {x:touch.clientX,y:touch.clientY,lastX:touch.clientX,lastTime:now,velocity:0,delta:0,horizontal:false};
    },{passive:true});
    track.addEventListener('touchmove', event => {
      if (!gesture) return;
      if (event.touches.length !== 1) {gesture = null;goTo(active,false,true);return;}
      const touch = event.touches[0], dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
      if (!gesture.horizontal) {
        if (Math.max(Math.abs(dx),Math.abs(dy)) < 10) return;
        if (Math.abs(dx) <= Math.abs(dy) * 1.25) {gesture = null;return;}
        gesture.horizontal = true;mount(active - 1);mount(active + 1);track.classList.add('dragging');host.dataset.moving = 'true';
      }
      event.preventDefault();
      const now = performance.now();gesture.velocity = (touch.clientX - gesture.lastX) / Math.max(1,now - gesture.lastTime);
      gesture.lastX = touch.clientX;gesture.lastTime = now;gesture.delta = dx;
      track.scrollLeft = clamp(active * width() - dx,Math.max(0,(active - 1) * width()),Math.min((pages.length - 1) * width(),(active + 1) * width()));
      paint();
    },{passive:false});
    function release(cancelled) {
      const current = gesture;gesture = null;if (!current?.horizontal) return;
      suppressClickUntil = performance.now() + 300;
      const velocity = performance.now() - current.lastTime > 120 ? 0 : current.velocity;
      goTo(cancelled ? active : targetIndex(active,pages.length,width(),current.delta,velocity),false,true);
    }
    track.addEventListener('touchend',()=>release(false),{passive:true});
    track.addEventListener('touchcancel',()=>release(true),{passive:true});
    track.addEventListener('click',event=>{if(performance.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
    track.addEventListener('scroll',schedulePaint,{passive:true});
    tabs.setAttribute('role','tablist');tabs.classList.add('pager-tabs');
    tabs.addEventListener('keydown',event=>{
      const map={ArrowLeft:active-1,ArrowRight:active+1,Home:0,End:pages.length-1};
      if(event.key in map){event.preventDefault();goTo(clamp(map[event.key],0,pages.length-1),true);}
    });
    function resize() {
      const height = Math.round(window.visualViewport?.height || innerHeight);
      if (height > 0) {
        document.documentElement.style.height = `${height}px`;document.body.style.height = `${height}px`;main.style.height = `${height}px`;
      }
      cancelAnimationFrame(animation);gesture = null;moving = false;host.dataset.moving = 'false';track.classList.remove('dragging');track.scrollLeft = active * width();paint();
    }
    window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
    requestAnimationFrame(resize);
    settle(active);
    return {
      root:page=>roots[pages.indexOf(page)],
      goTo,
      syncTabs:paint,
      refresh() {
        if (gesture?.horizontal || moving) {pendingRefresh = true;return;}
        cancelAnimationFrame(animation);gesture = null;moving = false;
        positions[active] = panes[active].scrollTop;valid.fill(false);mount(active);settle(active);
      },
    };
  };
})();
