(() => {
  window.createFeedback = element => {
    let timer;
    const close=document.createElement('button'),text=document.createElement('span');
    close.type='button';close.textContent='关闭';close.setAttribute('aria-label','关闭提示');
    const hide=()=>{clearTimeout(timer);element.hidden=true;};
    close.onclick=hide;
    return (value,tone='')=>{
      clearTimeout(timer);(document.querySelector('dialog[open]')||document.body).appendChild(element);element.replaceChildren(text,close);text.textContent=value||'';
      element.setAttribute('role',tone==='danger'?'alert':'status');element.className=`notice snackbar ${tone}`;element.hidden=!value;
      if(value)timer=setTimeout(hide,tone==='danger'?10000:5000);
    };
  };
})();
