(() => {
  const pages=['概览'],encoder=new TextEncoder(),decoder=new TextDecoder();
  let pendingImportPlan=null, pendingImportBundles=null;
  const viewStack=[];
  const operationReports=createOperationReporter(ats);
  let mihoyoLoginOperation=null;
  const empty=game=>({formatVersion:1,game,accounts:[],records:[],poolSyncState:[]});
  const state={page:'概览',directory:{hk4e:[],hkrpg:[]},datasets:{hk4e:empty('hk4e'),hkrpg:empty('hkrpg')},settings:{formatVersion:1,preferences:{}},selected:null,snapshot:null,link:null,query:'',pool:'all',rarity:0,busy:false,mihoyoCookie:null,mihoyoRoles:[],mihoyoRolesLoaded:false,mihoyoQr:null,mihoyoQrStatus:'',pendingDelete:null,recordPage:0,overviewPool:null,overviewScroll:{},acquireSource:'link',linkDraft:'',logGame:null,logRange:0,pendingLogout:false,syncMode:null,syncProgress:'',lastSync:null};
  Object.assign(state,{view:null,detailFilter:'all',analysisDraft:null,exportKeys:[],importKeys:[],transferResult:null,deleteKeys:[],accountDraft:null,entryAccountKey:null});
  let pendingWidgetEntry=null,handledWidgetEntry=null;
  state.distributionFilter={mode:"month",resources:[],pools:[]};state.recordDrill=null;let distributionDraft=null;
  state.referenceStores={};state.referenceErrors={};state.referenceResults={};state.referenceUpdating=false;
  let referenceReads=new Map();
  async function ensureReference(game){
    if(!window.gachaReference||referenceReads.has(game))return referenceReads.get(game);
    const pending=gachaReference.load(ats,game).then(store=>{state.referenceStores[game]=store;delete state.referenceErrors[game];}).catch(error=>{state.referenceErrors[game]=error.message;});referenceReads.set(game,pending);return pending;
  }
  const ui=Object.fromEntries(['tabs','progress','notice','content','refresh'].map(id=>[id,document.getElementById(id)]));
  const byId=id=>{const local=ui.content.querySelector(`[id="${id}"]`);if(local)return local;const global=document.getElementById(id);return global&&!global.closest('.tab-page')?global:null;};
  const all=selector=>ui.content.querySelectorAll(selector);
  const one=selector=>ui.content.querySelector(selector);
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function setBusy(value){state.busy=value;showLoading(value);document.querySelectorAll('button').forEach(button=>{if(button.closest('.snackbar,#tabs')||button.matches('.browse-action,.pool,.rarity,.pool-summary,.acquire-source')||['mihoyo-cancel','view-back','close-record','close-accounts'].includes(button.id))return;if(value){if(!button.hasAttribute('data-busy-disabled'))button.dataset.busyDisabled=String(button.disabled);button.disabled=true;}else if(button.hasAttribute('data-busy-disabled')){button.disabled=button.dataset.busyDisabled==='true';delete button.dataset.busyDisabled;}});const copy=byId('copy');for(const id of ['sync','sync-full']){const button=byId(id);if(button)button.disabled=value||(!state.link&&!state.linkDraft.trim());}if(copy)copy.disabled=value||!state.link;document.querySelectorAll('.acquire-input,.source-option,#custom-loss,.export-account,.import-account,.delete-account-choice,#account-note').forEach(input=>input.disabled=value);if(!value&&pendingDataPage){pendingDataPage=false;queueMicrotask(loadDataPage);}if(!value&&pendingMihoyoSource){pendingMihoyoSource=false;queueMicrotask(requestMihoyoSource);}if(!value&&!initializing&&pendingWidgetEntry)queueMicrotask(applyWidgetEntry);}
  const showLoading=createLoadingFeedback(ui.progress);
  const notice=createFeedback(ui.notice);
  let localData, initializing=true, sessionLoaded=false, sessionPending, pendingDataPage=false, pendingMihoyoSource=false, loadFailed=false, sessionError=false;
  async function ensureSession(){
    if(sessionLoaded)return;
    if(!sessionPending)sessionPending=(async()=>{
      const secret=await ats.call('storage.secret.get',{datasetId:'mihoyo-session',key:'cookie'});
      let cookie=secret.found?secret.value:null;
      if(!cookie){const bytes=await ats.readDataset('mihoyo-session',1048576);const value=bytes?JSON.parse(decoder.decode(bytes)):{};cookie=value.session||null;if(cookie)await ats.call('storage.secret.set',{datasetId:'mihoyo-session',key:'cookie',value:cookie});}
      state.mihoyoCookie=cookie;sessionLoaded=true;
    })().finally(()=>{sessionPending=null;});
    return sessionPending;
  }
  async function load(){let baseLoaded=false;loadFailed=false;initializing=true;setBusy(true);notice('');try{
    localData=gachaInitialLoad.createLoader(ats.readDataset,(game,bytes)=>{state.datasets[game]=gachaModel.normalizeDataset(bytes?JSON.parse(decoder.decode(bytes)):null,game);});
    const [settings,directory]=await Promise.all([ats.readDataset('gacha-settings',1048576),gachaAccountDirectory.load(ats)]);
    state.directory=directory.accounts;
    if(directory.errors?.length)notice(`${directory.errors.map(game=>gachaModel.games[game].label).join('、')}账号列表读取失败，请刷新重试`,'danger');
    else if(directory.cacheError)notice('账号列表缓存未保存，下次将重新读取','danger');
    state.settings=settings?JSON.parse(decoder.decode(settings)):{formatVersion:1,preferences:{}};
    state.datasets={hk4e:empty('hk4e'),hkrpg:empty('hkrpg')};state.selected=null;state.snapshot=null;sessionLoaded=false;sessionError=false;
    state.logRange=Number(preference('log-lookback-minutes',0));if(![0,5,30,120,1440].includes(state.logRange))state.logRange=0;
    await pager.initialize({deferContent:true});
    baseLoaded=true;
    referenceReads=new Map();
    for(let attempt=0;attempt<2;attempt++){state.selected=accounts().find(account=>gachaModel.key(account)===state.entryAccountKey)||gachaPresentation.selection(accounts(),state.selected,state.settings);if(!state.selected)break;await Promise.all([localData.ensure(state.selected.game),ensureReference(state.selected.game)]);if(localData.has(state.selected.game))break;}
    if(['export','delete'].includes(state.view?.kind))await localData.all();
    if(state.page==='获取'&&state.acquireSource==='mihoyo')try{await ensureSession();}catch(error){sessionError=true;notice(error.message,'danger');}
    selectInitial();render();
  }catch(error){loadFailed=!baseLoaded;if(baseLoaded)selectInitial();notice(error.message||'读取本地记录失败','danger');render();}finally{initializing=false;setBusy(false);document.body?.classList.remove('initializing');document.body?.removeAttribute('aria-busy');}}
  async function selectAccount(key,{persist=true}={}){
    if(state.busy||loadFailed)return;
    const wanted=accounts().find(account=>gachaModel.key(account)===key);if(!wanted)return;
    if(state.selected&&gachaModel.key(state.selected)===key&&!state.snapshot)return retryRecords();
    setBusy(true);
    try{
      await Promise.all([localData.ensure(wanted.game),ensureReference(wanted.game)]);
      const actual=accounts().find(account=>gachaModel.key(account)===key);if(!actual)throw Error('账号列表已变化，请刷新后重试');
      const candidate=selectionState(actual);
      if(persist)await saveSettings(candidate.settings);
      if(persist)state.entryAccountKey=null;
      state.distributionFilter={mode:"month",resources:[],pools:[]};state.recordDrill=null;
      Object.assign(state,candidate,{recordPage:0,overviewPool:null,pool:'all',rarity:0,query:''});
      if(state.view?.kind==='analysis')state.analysisDraft=JSON.parse(JSON.stringify(gachaPresentation.analysisOptions(state.settings,state.selected)));
      render();
    }catch(error){notice(error.message,'danger');render();}finally{setBusy(false);}
  }
  async function retryRecords(){
    if(state.busy||loadFailed||!state.selected)return;
    setBusy(true);
    try{await localData.ensure(state.selected.game);selectInitial();}
    catch(error){notice(error.message,'danger');}
    finally{render();setBusy(false);}
  }
  async function loadDataPage(){if(initializing||loadFailed||!localData||(localData.has('hk4e')&&localData.has('hkrpg')))return;if(state.busy){pendingDataPage=true;return;}setBusy(true);try{await localData.all();}catch(error){notice(error.message,'danger');}finally{render();setBusy(false);}}
  async function openMihoyo(){sessionError=false;setBusy(true);try{await ensureSession();render();}catch(error){sessionError=true;notice(error.message,'danger');render();}finally{setBusy(false);}if(!sessionError&&state.mihoyoCookie&&!state.mihoyoRolesLoaded)await loadMihoyoRoles(state.mihoyoCookie);}
  function requestMihoyoSource(){if(state.page!=='获取'||state.acquireSource!=='mihoyo')return;if(state.busy){pendingMihoyoSource=true;return;}openMihoyo();}
  const accounts=()=>gachaAccountDirectory.accounts(state.datasets,state.directory,game=>!!localData?.has(game));
  function preference(name,fallback){const item=state.settings.preferences?.[name];return item?item.value:fallback;}
  function setPreference(name,type,value){state.settings.preferences=state.settings.preferences||{};state.settings.preferences[name]={type,value};}
  let analyzedAccount=null;
  function selectionState(selected){
    const settings=JSON.parse(JSON.stringify(state.settings));let snapshot=null;
    if(selected&&localData.has(selected.game)){
      const key=gachaModel.key(selected);settings.preferences=settings.preferences||{};
      settings.preferences['selected-account']={type:'string',value:key};settings.preferences.selected_account_key={type:'string',value:key};settings.preferences['last-account:'+selected.game]={type:'string',value:key};
      const dataset=state.datasets[selected.game],options=gachaPresentation.analysisOptions(settings,selected);
      const overrides=preference('record-up-overrides:'+key,{});
      const signature=JSON.stringify([key,selected.timezone,selected.timezoneAssumed,selected.region,options,overrides]),reference=window.gachaReference?.active(selected.game);
      if(analyzedAccount?.dataset===dataset&&analyzedAccount.signature===signature&&analyzedAccount.reference===reference)snapshot=analyzedAccount.snapshot;
      else{const records=dataset.records.filter(item=>item.uid===selected.uid);snapshot=gachaModel.snapshot(selected.game,records,options.losses,options.sources,Number(selected.timezone??8),{...selected,overrides});analyzedAccount={dataset,signature,reference,snapshot};}
    }
    return {selected,settings,snapshot};
  }
  function selectInitial(){Object.assign(state,selectionState(accounts().find(account=>gachaModel.key(account)===state.entryAccountKey)||gachaPresentation.selection(accounts(),state.selected,state.settings)));}
  function renderTabs(){ui.tabs.hidden=pages.length<2;ui.tabs.replaceChildren(...pages.map(page=>{const button=document.createElement('button');button.textContent=page;button.className=page===state.page?'active':'';button.onclick=()=>pager.goTo(page);return button;}));pager.syncTabs();}
  function drawPage(page,root){const previousPage=state.page,previousRoot=ui.content;state.page=page;ui.content=root;try{
    if(loadFailed){ui.content.innerHTML='<div class="empty">本地记录读取失败。<button class="secondary" id="retry-load">重试</button></div>';byId('retry-load').onclick=load;return;}
    if((page==='概览'||page==='记录')&&state.selected&&!localData?.has(state.selected.game)){
      ui.content.replaceChildren();
      if(localData?.failed(state.selected.game)){
        ui.content.innerHTML=`<div class="empty">${gachaModel.games[state.selected.game].label}记录读取失败。<button class="secondary" id="retry-records">重试</button></div>`;
        byId('retry-records').onclick=retryRecords;
      }
      return;
    }
    if(state.view&&root===document.getElementById('view-content'))renderView();
    else if(page==='概览')renderOverview();else if(page==='记录')renderRecords();else if(page==='获取')renderAcquire();else renderData();bind();applyFilters();
  }finally{state.page=previousPage;ui.content=previousRoot;}}
  const pager=createTabPager({host:ui.content,tabs:ui.tabs,pages,initialPage:state.page,preloadNeighbors:false,isBusy:()=>false,renderPage:drawPage,onSelect:(page,root)=>{state.page=page;ui.content=root;renderTabs();setBusy(state.busy);if(page==='获取'&&state.acquireSource==='mihoyo'&&!state.busy)openMihoyo();}});
  ui.content=pager.root(state.page);
  function render(){renderAccounts();renderTabs();if(state.view){ui.content=document.getElementById('view-content');drawPage(state.page,ui.content);}else{ui.content=pager.root(state.page);pager.refresh();}updateViewChrome();backNavigation.sync();}
  function accountSelect(){return '';}
  function renderAccounts(){const target=byId('accounts'),account=state.selected,note=account?preference('account-note:'+gachaModel.key(account),''):'';target.innerHTML=`<nav class="wish-game-switch" aria-label="选择游戏">${['hk4e','hkrpg'].map(game=>`<button type="button" data-switch-game="${game}" aria-pressed="${account?.game===game}">${gachaModel.games[game].label}</button>`).join('')}</nav><div class="wish-account-line"><button class="wish-account-picker" id="account-picker" aria-label="选择当前游戏的账号"><span><strong>${esc(note||(account?'UID '+account.uid:'选择账号'))} ⌄</strong>${note?`<small>UID ${esc(account.uid)}</small>`:''}</span></button><button class="secondary browse-action" id="open-acquire">获取记录</button></div>`;target.querySelectorAll('[data-switch-game]').forEach(button=>button.onclick=()=>selectGame(button.dataset.switchGame));byId('account-picker').onclick=showAccounts;byId('open-acquire').onclick=()=>openAcquireView();}
  async function selectGame(game){if(state.busy||!gachaModel.games[game])return;const choices=accounts().filter(account=>account.game===game),recent=preference('last-account:'+game,'');const target=choices.find(account=>gachaModel.key(account)===recent)||choices[0];if(target)await selectAccount(gachaModel.key(target));else {state.logGame=game;await openAcquireView(game);notice(gachaModel.games[game].label+'还没有本地账号，可获取或导入记录。');}}
  function widgetEntryAccount(entry){
    const config=entry.configuration||{};
    if(config.account)return config.account;
    const games=(config.pools||[]).map(pool=>String(pool).split(':')[0]).filter(game=>gachaModel.games[game]);
    const game=games.includes(state.selected?.game)?state.selected.game:games[0]||state.selected?.game||'hk4e';
    return config['account_'+game];
  }
  function queueWidgetEntry(entry){if(!entry?.id||entry.id===handledWidgetEntry)return;pendingWidgetEntry=entry;const key=widgetEntryAccount(entry);if(initializing&&typeof key==='string')state.entryAccountKey=key;if(!initializing&&!state.busy)applyWidgetEntry();}
  async function applyWidgetEntry(force=false){const entry=pendingWidgetEntry;if(!entry||entry.id===handledWidgetEntry&&!force)return;handledWidgetEntry=entry.id;
    if(!force&&(accountNoteDirty()||state.view?.kind==='analysis'&&analysisDirty())){confirmAction('放弃未保存的修改？','打开首页卡片会离开当前编辑。','放弃并打开',()=>{state.accountDraft=null;state.analysisDraft=null;applyWidgetEntry(true);});return;}
    pendingWidgetEntry=null;const key=widgetEntryAccount(entry);if(key)state.entryAccountKey=key;
    if(key){if(!accounts().some(account=>gachaModel.key(account)===key)){state.entryAccountKey=null;notice('这张小部件绑定的账号已不存在，请重新配置。','danger');return;}if(!state.selected||gachaModel.key(state.selected)!==key)await selectAccount(key,{persist:false});if(!state.selected||gachaModel.key(state.selected)!==key||!state.snapshot)return;}
    viewStack.length=0;state.view=null;state.page='概览';pager.goTo('概览');render();
    if(entry.presetId==='records')openView('data');else if(entry.configuration?.pool&&state.snapshot?.stats.some(pool=>pool.type===entry.configuration.pool))openView('pool',entry.configuration.pool);
  }

  function openView(kind,key,context={}){
    if(kind==='analysis'&&!state.selected)return;
    if(kind==='account')state.accountDraft={key,value:preference('account-note:'+key,'')};
    viewStack.push({view:state.view,page:state.page,recordDrill:state.recordDrill,scroll:document.getElementById('view-scroll').scrollTop||0});
    state.view={kind,key,...context};state.page=kind==='acquire'?'获取':['pool','months','distribution-detail'].includes(kind)?'概览':kind==='records'?'记录':'数据';
    if(kind==='pool')state.detailFilter='all';
    if(kind==='analysis')state.analysisDraft=JSON.parse(JSON.stringify(gachaPresentation.analysisOptions(state.settings,state.selected)));
    if(kind==='export'){state.exportKeys=accounts().map(gachaModel.key);state.transferResult=null;}
    if(kind==='delete')state.deleteKeys=[];
    render();document.getElementById('view-scroll').scrollTop=0;
    if(['export','delete'].includes(kind))loadDataPage();
    if(kind==='reference')Promise.all(['hk4e','hkrpg'].map(ensureReference)).then(()=>{if(state.view?.kind==='reference')render();});
    if(kind==='acquire'&&state.acquireSource==='mihoyo'&&!state.busy)openMihoyo();
  }
  let recordLinkCache;
  const cachedLinks=()=>recordLinkCache||(recordLinkCache=gachaLinkCache.create(ats));
  const preparedLinks=new Map();
  let acquireRequest=0;
  async function openAcquireView(game=state.selected?.game||state.logGame||'hk4e'){
    if(!gachaModel.games[game])return;
    const request=++acquireRequest,selected=state.selected?gachaModel.key(state.selected):null;
    const uid=state.selected?.game===game?state.selected.uid:null;
    if(!state.busy&&!state.linkDraft.trim()&&state.link?.game!==game){
      if(state.link)preparedLinks.set(state.link.game,{link:state.link,uid:state.cachedLinkUid??null,cached:state.cachedLink===true,warning:state.cacheWarning||''});
      state.link=null;state.cachedLink=false;state.cacheWarning='';
    }
    if(!state.busy&&!state.link&&!state.linkDraft.trim())try{
      const prepared=preparedLinks.get(game);
      const cached=prepared&&(!uid||prepared.uid==null||prepared.uid===String(uid))?prepared:await cachedLinks().get(game,uid);
      if(request!==acquireRequest||selected!==(state.selected?gachaModel.key(state.selected):null))return;
      if(cached&&!state.link&&!state.linkDraft.trim()){state.link=cached.link;state.cachedLink=cached.cached!==false;state.cachedLinkUid=cached.uid;state.cacheWarning=cached.warning||'';}
    }catch(error){notice('链接缓存读取失败，可重新获取链接','danger');}
    if(request!==acquireRequest||selected!==(state.selected?gachaModel.key(state.selected):null))return;
    state.logGame=game;openView('acquire');
  }
  function linkStatus(){
    return state.cacheWarning||(state.link?(state.cachedLink?(state.cachedLinkUid==null?'链接已在本机加密缓存；获取时确认账号':'链接在本机加密缓存，可继续增量检查或完整刷新'):'链接已准备，可继续获取记录'):'粘贴链接，或从下方设备日志与米游社获取');
  }
  async function cachePreparedLink(uid=null){
    const link=state.link;if(!link)return;
    state.cachedLink=false;state.cachedLinkUid=uid;state.cacheWarning='';
    try{await cachedLinks().save(link,uid);if(state.link===link){state.cachedLink=true;state.cachedLinkUid=uid;}}
    catch(error){if(state.link===link)state.cacheWarning='链接未能保存到本机，可继续本次获取。';}
    if(state.link===link&&state.view?.kind==='acquire')byId('link-status').textContent=linkStatus();
  }
  function accountNoteDirty(){return state.view?.kind==='account' && !!state.accountDraft && state.accountDraft.value.trim()!==preference('account-note:'+state.view.key,'');}
  function closeDistributionMenu(){const menu=one('.distribution-detail-menu[open]');if(!menu)return false;menu.open=false;return true;}
  function backView(force=false){
    if(closeDistributionMenu())return;
    if(!force&&accountNoteDirty()){
      if(state.busy){notice('备注正在保存，完成后可返回');return;}
      confirmAction('放弃未保存的备注？','已经保存的账号备注与记录不会改变。','放弃修改',()=>{state.accountDraft=null;backView(true);});return;
    }
    if(state.view?.kind==='analysis'&&state.analysisSaving){notice('正在应用统计设置，完成后可返回');return;}
    if(!force&&state.view?.kind==='analysis'&&analysisDirty()){confirmAction('放弃未应用的修改？','离开后保留上次已经保存的统计设置。','放弃修改',()=>backView(true));return;}
    if(!force&&state.view?.kind==='import'&&state.busy)return;
    const previous=viewStack.pop()||{view:null,page:'概览',scroll:0};state.view=previous.view;state.page=previous.page;state.recordDrill=previous.recordDrill||null;
    render();document.getElementById('view-scroll').scrollTop=previous.scroll;
  }
  function updateViewChrome(){
    document.body?.classList.toggle('secondary-view',!!state.view);
    const root=document.getElementById('view-scroll');root.hidden=!state.view;
    document.getElementById('view-header').hidden=!state.view;
    if(!state.view)return;
    const titles={reference:'游戏资料',delete:'删除记录',acquire:'获取记录',data:'账号管理',analysis:'统计设置',export:'导出记录',import:'导入记录',account:'管理本地账号',months:'记录分布','distribution-detail':'记录分析'};
    document.getElementById('view-title').textContent=state.view.kind==='pool'?state.snapshot?.stats.find(item=>item.type===state.view.key)?.label||'卡池详情':titles[state.view.kind]||'记录';
    const contextAccount=['pool','analysis','records','months','distribution-detail'].includes(state.view.kind)?state.selected:null;
    document.getElementById('view-subtitle').textContent=contextAccount?`${gachaModel.games[contextAccount.game].label} · ${contextAccount.uid}`:'';
  }
  function renderView(){
    const kind=state.view.kind;
    if(kind==='pool')ui.content.innerHTML=gachaViews.pool(state);
    else if(kind==='acquire')renderAcquire();
    else if(kind==='data')renderData();
    else if(kind==='records')renderRecords();
    else if(kind==='months')ui.content.innerHTML=gachaViews.months(state);
    else if(kind==='distribution-detail')ui.content.innerHTML=gachaViews.distributionSummary(state);
    else if(kind==='analysis')ui.content.innerHTML=gachaViews.analysis(state);
    else if(kind==='reference')ui.content.innerHTML=gachaViews.reference(state);
    else if(kind==='export')renderExport();
    else if(kind==='import')renderImport();
    else if(kind==='account')renderAccount();
    else if(kind==='delete')renderDelete();
  }
  function showRecords(pool='all',rarity=0,query=''){
    state.recordDrill=null;state.pool=pool;state.rarity=Number(rarity);state.query=query;state.recordPage=0;
    if(state.view?.kind==='records'){render();document.getElementById('view-scroll').scrollTop=0;}else openView('records');
  }
  function openDistributionSummary(filter,key,label){
    if(!state.selected||!state.snapshot)return;
    openView('distribution-detail',key,{filter:JSON.parse(JSON.stringify(filter)),label,chart:'resources'});
  }
  function showDistributionRecords(rarity=0){
    const scope={filter:state.view.filter,key:state.view.key,label:state.view.label};
    showRecords('all',rarity);state.recordDrill=scope;render();
  }
  function showAccounts(){
    const game=state.selected?.game||state.logGame||'hk4e',counts=accountCounts(),dialog=document.getElementById('accounts-dialog');
    document.getElementById('accounts-title').textContent=gachaModel.games[game].label+' · 选择账号';
    document.getElementById('account-choices').innerHTML=accounts().filter(account=>account.game===game).map(account=>{const chosen=state.selected&&gachaModel.key(account)===gachaModel.key(state.selected);return `<button class="wish-account-entry account-choice" data-choose-account="${esc(gachaModel.key(account))}" aria-pressed="${!!chosen}" ${chosen?'disabled':''}><span class="wish-game-icon">${account.game==='hk4e'?'原':'星'}</span><span class="grow"><strong>${esc(preference('account-note:'+gachaModel.key(account),'UID '+account.uid))}</strong>${preference('account-note:'+gachaModel.key(account),'')?`<small>UID ${esc(account.uid)}</small>`:''}<small>${counts[gachaModel.key(account)]==null?'点击查看本地记录':counts[gachaModel.key(account)]+' 条记录'}</small></span>${chosen?'<span class="account-selected">✓ 已选择</span>':'<span aria-hidden="true">›</span>'}</button>`;}).join('')||'<p>这个游戏暂无本地账号，请先获取或导入记录。</p>';
    dialog.querySelectorAll('[data-choose-account]').forEach(button=>button.onclick=async()=>{dialog.close();await selectAccount(button.dataset.chooseAccount);});
    dialog.showModal();setBusy(state.busy);
  }
  function bindRecordRows(){all('[data-record]').forEach(button=>button.onclick=()=>showRecord(button.dataset.record));}
  function showRecord(identity){
    const item=gachaPresentation.recordDetail(state.snapshot,state.selected?.game,identity);if(!item)return;
    const {record,pool,pull,pity}=item;
    document.getElementById('record-detail').innerHTML=`<h2>${esc(record.name||'未知物品')}</h2><dl class="record-fields"><div><dt>星级</dt><dd>${Number(record.rank_type)} 星</dd></div><div><dt>时间</dt><dd>${esc(record.time)}</dd></div><div><dt>卡池</dt><dd>${esc(pool?.label||'未知卡池')}</dd></div><div><dt>本地连续抽数</dt><dd>${pity??'—'} 抽</dd></div><div><dt>记录 ID</dt><dd>${esc(record.id)}</dd></div><div><dt>物品类型</dt><dd>${esc(record.item_type||'未提供')}</dd></div>${pool?.tracksUp&&pull&&pull.isLoss!==null?`<div><dt>归属</dt><dd>${pull.isLoss?'非 UP':'UP'}（按当前账号设置分析）</dd></div>`:''}</dl>`;
    const resolved=window.gachaReference?.resolve(record,state.selected.game,gachaReference.recordContext(state.snapshot.records,state.selected.game,state.selected)),evidence=pull?.evidence;
    const detail=document.getElementById('record-detail'),fields=[];
    if(resolved?.possibleError)detail.insertAdjacentHTML('beforeend','<p class="record-warning"><span class="badge warning">可能错误</span> '+esc(resolved.possibleError)+' 保留所指卡池，请核对原始记录或资料。</p>');
    const field=(label,value)=>{if(value!==undefined&&value!==null&&value!=='')fields.push(`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`);};
    field('原始池类型',record.gachaTypeAssumed?'请求类别 '+record.gacha_type:record.gacha_type);field('卡池 ID',record.gacha_id||record.schedule_id);field('物品 ID',record.item_id);
    const timezone=window.gachaReference?.timezoneOf(record,state.selected);if(timezone!==null&&timezone!==undefined)field('时区','UTC'+(timezone>=0?'+':'')+timezone);
    field('版本',resolved?.version);if(resolved?.phase)field('期次','第 '+resolved.phase.split(':')[1]+' 期');if(resolved?.banner)field('独立卡池',gachaReference.bannerName(resolved.banner,gachaReference.active(state.selected.game)));else if(resolved?.nativeIdentity)field('独立卡池',resolved.nativeIdentity.label);if(resolved?.identityBasis)field('归类依据',resolved.identityBasis);if(resolved?.identityReason)field('卡池归类',resolved.identityReason);if(resolved?.conflict)field('资料核对',resolved.conflict);
    if(evidence?.value!==null&&evidence?.value!==undefined)field('判断依据',evidence.reason);
    if(fields.length)detail.insertAdjacentHTML('beforeend','<dl class="record-fields">'+fields.join('')+'</dl>');
    if(Object.keys(record.fieldConflicts||{}).length)detail.insertAdjacentHTML('beforeend','<details class="record-evidence"><summary>原始字段存在冲突</summary>'+Object.entries(record.fieldConflicts).map(([field,values])=>'<p>'+esc(field)+'：保留 '+esc(record[field])+'；其他来源 '+esc(values.map(value=>String(value.value)+'（'+value.source+'）').join(' / '))+'</p>').join('')+'</details>');
    if(pool?.tracksUp&&pull){detail.insertAdjacentHTML('beforeend','<p class="supporting">人工修订优先于原始标记和资料，原始记录保留。</p><div class="record-corrections"><button class="secondary" data-record-override="auto">按资料判断</button><button class="secondary" data-record-override="up">确认 UP</button><button class="secondary" data-record-override="other">确认非 UP</button></div>');detail.querySelectorAll('[data-record-override]').forEach(button=>button.onclick=()=>setRecordOverride(identity,button.dataset.recordOverride==='auto'?null:button.dataset.recordOverride==='up'));}
    if(resolved?.candidates?.length)detail.insertAdjacentHTML('beforeend','<details class="record-evidence"><summary>资料证据详情</summary><p>资料修订 '+esc(resolved.revision)+'</p><p>判断规则 '+resolved.ruleVersion+'</p>'+resolved.candidates.map(banner=>'<p>'+esc(gachaReference.bannerName(banner,gachaReference.active(state.selected.game)))+' · '+esc(banner.source)+'<br>'+esc(banner.start)+(banner.end?' — '+esc(banner.end):' · 国服资料标注长期，未公布截止')+(banner.evidence?'<br>'+esc(banner.evidence.url):'')+'</p>').join('')+'</details>');
    const button=document.getElementById('record-open-pool');button.hidden=!pool;button.onclick=()=>{document.getElementById('record-dialog').close();openView('pool',pool.type);};
    document.getElementById('record-dialog').showModal();
  }
  function analysisDirty(){return !!state.analysisDraft&&JSON.stringify(state.analysisDraft)!==JSON.stringify(gachaPresentation.analysisOptions(state.settings,state.selected));}
  async function updateReference(game,{automatic=false}={}){
    if(state.referenceUpdating||state.busy||!window.gachaReference)return;
    const operation=operationReports.start('更新'+gachaModel.games[game].label+'游戏资料');state.referenceUpdating=true;render();
    try{
      await ensureReference(game);const records=state.datasets[game].records,accountMap=new Map(state.datasets[game].accounts.map(account=>[account.uid,account]));
      const accountRecords=new Map();for(const record of records){if(!accountRecords.has(record.uid))accountRecords.set(record.uid,[]);accountRecords.get(record.uid).push(record);}
      const contexts=()=>new Map([...accountMap].map(([uid,account])=>[uid,gachaReference.recordContext(accountRecords.get(uid)||[],game,account)]));let analysisAccounts=contexts();
      const signature=record=>{const account=analysisAccounts.get(record.uid)||{},result=Number(record.rank_type)===5?gachaReference.upEvidence(record,game,account,[game==='hk4e'?'paimon-moe':'star-rail-station']):gachaReference.resolve(record,game,account);return JSON.stringify([result.value,result.version,result.phase,result.banner?.id,result.candidates.map(item=>item.id).sort()]);};
      const before=new Map();for(let i=0;i<records.length;i++){before.set(gachaModel.recordKey(game,records[i]),signature(records[i]));if(i%512===511)await new Promise(resolve=>setTimeout(resolve,0));}
      const result=await gachaReference.update(ats,game);state.referenceStores[game]=result.store;delete state.referenceErrors[game];
      analysisAccounts=contexts();
      let changedRecords=0;for(let i=0;i<records.length;i++){const record=records[i];if(signature(record)!==before.get(gachaModel.recordKey(game,record)))changedRecords++;if(i%512===511)await new Promise(resolve=>setTimeout(resolve,0));}
      state.referenceResults[game]={changed:result.changed,changedRecords:localData?.has(game)?changedRecords:null};selectInitial();
      operation.success(result.changed?'资料已保存并重新分析':'资料检查完成，无变化');if(!automatic)notice(result.changed?(localData?.has(game)?`资料已更新，${changedRecords} 条记录的归属或 UP 依据发生变化`:'资料已更新，该游戏记录尚未读取，打开账号后使用新资料分析'):'游戏资料没有变化','success');
    }catch(error){state.referenceErrors[game]=error.message;operation.fail();if(!automatic)notice('资料更新失败，已保留可用资料：'+error.message,'danger');}
    finally{state.referenceUpdating=false;render();}
  }
  const autoAttempts=new Map();
  async function maybeUpdateReference(){
    if(!window.gachaReference||!preference('reference-auto-check',false)||state.busy||state.referenceUpdating)return;
    for(const game of ['hk4e','hkrpg']){
      await ensureReference(game);const checked=Math.max(state.referenceStores[game]?.checkedAt||0,autoAttempts.get(game)||0);
      if(Date.now()-checked<7*24*3600000||state.busy||state.referenceUpdating)continue;
      autoAttempts.set(game,Date.now());await updateReference(game,{automatic:true});
    }
  }
  async function setReferenceAutoCheck(enabled){
    if(state.busy)return;setBusy(true);
    const settings=JSON.parse(JSON.stringify(state.settings));settings.preferences||={};settings.preferences['reference-auto-check']={type:'boolean',value:enabled};
    try{await saveSettings(settings);state.settings=settings;render();}catch(error){notice(error.message,'danger');render();}finally{setBusy(false);}if(state.settings.preferences?.['reference-auto-check']?.value)maybeUpdateReference();
  }
  async function setRecordOverride(identity,value){
    if(state.busy||!state.selected)return;const operation=operationReports.start('修订记录 UP 归属'),key='record-up-overrides:'+gachaModel.key(state.selected),settings=JSON.parse(JSON.stringify(state.settings)),overrides={...preference(key,{})};
    if(value===null)delete overrides[identity];else overrides[identity]=value;settings.preferences||={};settings.preferences[key]={type:'object',value:overrides};setBusy(true);
    try{await saveSettings(settings);state.settings=settings;selectInitial();operation.success('用户修订已保存');showRecord(identity);render();notice('已保存修订，原始记录保留','success');}catch(error){operation.fail();notice(error.message,'danger');}finally{setBusy(false);}
  }
  function updateAnalysisDraft(){state.analysisDraft={sources:[...all('.source-option:checked')].map(item=>item.value),losses:byId('custom-loss')?[...new Set(byId('custom-loss').value.split(/\r?\n/).map(item=>item.trim()).filter(Boolean))]:[]};const dirty=analysisDirty();byId('save-analysis').disabled=state.busy||!dirty;byId('analysis-status').textContent=dirty?'有未应用的修改':'当前设置已保存';}
  async function saveAnalysis(){
    if(state.busy||!analysisDirty())return;const operation=operationReports.start('保存统计设置');state.analysisSaving=true;setBusy(true);
    try{const settings=JSON.parse(JSON.stringify(state.settings));settings.preferences||={};settings.preferences[gachaPresentation.sourceKey(state.selected)]={type:'stringSet',value:state.analysisDraft.sources};if(state.selected.game==='hkrpg')settings.preferences[gachaPresentation.lossKey(state.selected)]={type:'stringSet',value:state.analysisDraft.losses};await saveSettings(settings);operation.success('统计设置已保存');state.settings=settings;selectInitial();render();notice('已保存此账号的统计设置','success');}
    catch(error){operation.fail();notice(error.message,'danger');}finally{state.analysisSaving=false;setBusy(false);}
  }
  function confirmAction(title,description,label,action){const dialog=document.getElementById('confirm-dialog');document.getElementById('confirm-title').textContent=title;document.getElementById('confirm-description').textContent=description;const button=document.getElementById('confirm-action');button.textContent=label;button.onclick=()=>{dialog.close();action();};dialog.showModal();}

  function renderOverview(){ui.content.innerHTML=gachaViews.overview(state);}
  function renderRecords(){ui.content.innerHTML=gachaViews.records(state);}
  function renderAcquire(){
    const roles=state.mihoyoRoles.filter(role=>role.game==='hk4e'),game=state.logGame||state.selected?.game||'hk4e';
    ui.content.innerHTML=`<section class="card acquire-link" id="link-panel"><div class="link-heading"><span class="link-step">${state.link?'链接已准备':'准备链接'}</span><h2>${state.link?gachaModel.games[state.link.game].label+'记录':'获取抽卡记录'}</h2><p id="link-status" class="supporting">${esc(linkStatus())}</p></div>${state.link?'':`<textarea id="link" class="acquire-input" rows="2" aria-label="抽卡链接" placeholder="粘贴或输入完整抽卡链接">${esc(state.linkDraft)}</textarea>`}<div class="actions link-actions"><button id="sync">获取新记录</button><button id="sync-full" class="secondary">刷新全部记录</button></div><div class="link-secondary"><button id="clipboard" class="text-button">${state.link?'粘贴新链接':'从剪贴板粘贴'}</button>${state.link?'<button id="copy" class="text-button">复制链接</button><button id="clear-link" class="text-button">清除链接</button>':''}</div><p id="sync-progress" class="sync-progress" role="status" ${state.syncMode?'':'hidden'}>${esc(state.syncProgress)}</p>${state.lastSync?`<div class="sync-result"><div><strong>${state.lastSync.mode==='full'?'完整刷新完成':'增量获取完成'}</strong><span class="supporting">${esc(state.lastSync.time)} · 账号 ${esc(state.lastSync.uid)}</span></div><div class="sync-metrics"><span>新增 <strong>${state.lastSync.inserted}</strong> 条</span><span>检查 ${state.lastSync.scanned} 条</span><button id="view-records" class="text-button">查看记录</button></div></div>`:''}<details class="sync-help"><summary>两种获取方式有什么区别？</summary><p class="supporting">增量会回看近期批次；完整刷新扫描该账号各卡池的接口可见历史。两者均按卡池和记录 ID 合并，保留本地历史。链接在本机加密缓存，明确失效或手动清除后删除，不会自动获取记录。</p></details></section><section class="card" id="acquire-log"><h3>从设备日志获取</h3><p class="supporting">在游戏或云游戏 App 中打开抽卡历史，加载完成后返回查找。</p><div class="acquire-options"><label>游戏<select id="log-game" class="acquire-input">${[['hk4e','原神'],['hkrpg','星穹铁道']].map(([id,title])=>`<option value="${id}" ${game===id?'selected':''}>${title}</option>`).join('')}</select></label></div><div class="actions"><button id="find-log" class="secondary">查找链接</button></div><p class="supporting">需要 Shizuku 已运行并授权。只能搜索系统仍保留的日志，不支持在浏览器中打开的云游戏网页版。查不到时可改为粘贴链接。</p></section><section class="card" id="acquire-mihoyo"><div class="section"><div><h3>米游社账号</h3><p class="supporting">仅支持国服原神；星铁请使用设备日志或粘贴链接。</p></div></div>${state.mihoyoCookie?'<p class="supporting">已保存登录状态</p>':'<p>扫码登录后，选择角色获取链接。</p>'}${state.mihoyoQr?`<div id="mihoyo-qr" class="qr"></div><p>${esc(state.mihoyoQrStatus||'等待扫码确认')}</p><button id="mihoyo-cancel" class="secondary">取消扫码</button>`:''}${roles.map((role,index)=>`<div class="role"><div><h3>${esc(role.nickname||'原神角色')}</h3><p class="supporting">${esc(role.regionName)} · ${esc(role.uid)} · ${role.level} 级</p></div><button class="mihoyo-role" data-index="${index}">获取链接</button></div>`).join('')}<div class="actions">${state.mihoyoCookie?'<button id="mihoyo-roles" class="secondary">刷新角色</button>':''}<button id="mihoyo-login" class="secondary">${state.mihoyoCookie?'重新扫码':'扫码登录'}</button>${state.mihoyoCookie?'<button id="mihoyo-logout" class="secondary danger">退出账号</button>':''}</div>${state.pendingLogout?'<div class="logout-confirm"><p>退出后会删除本机保存的米游社登录状态，抽卡记录会保留。</p><div class="actions"><button id="confirm-logout" class="secondary danger">确认退出</button><button id="cancel-logout" class="text-button">取消</button></div></div>':''}</section>`;
    organizeAcquireSources();
  }
  function organizeAcquireSources(){
    const nav=document.createElement('nav');nav.className='acquire-sources';nav.setAttribute('aria-label','选择记录来源');
    for(const [key,label] of [['link','粘贴链接'],['log','设备日志'],['mihoyo','米游社']]){
      const button=document.createElement('button');button.type='button';button.className='secondary acquire-source';button.textContent=label;button.setAttribute('aria-pressed',String(state.acquireSource===key));
      button.innerHTML=gachaViews.icon(key==='log'?'terminal':key==='mihoyo'?'account':'link')+`<span>${label}</span>`;
      button.onclick=()=>{state.acquireSource=key;render();if(key==='mihoyo')requestMihoyoSource();};nav.append(button);
    }
    ui.content.prepend(nav);
    const intro=document.createElement('div');intro.innerHTML=gachaViews.intro('添加新的记录','选择记录来源','新记录会与已有历史合并。');ui.content.prepend(intro);
    for(const [key,id] of [['link','link-panel'],['log','acquire-log'],['mihoyo','acquire-mihoyo']])byId(id).hidden=state.acquireSource!==key;
    if(!sessionLoaded){const panel=byId('acquire-mihoyo');panel.replaceChildren();if(sessionError){panel.innerHTML='<p>登录状态读取失败。</p><button id="retry-session" class="secondary">重试</button>';byId('retry-session').onclick=openMihoyo;}}
    const help=one('.sync-help'),full=byId('sync-full');if(help&&full){const actions=document.createElement('div');actions.className='actions';actions.append(full);help.append(actions);}
  }
  function renderData(){
    const counts=accountCounts(),loadedAccounts=accounts().map(account=>({...account,note:preference('account-note:'+gachaModel.key(account),'')}));
    ui.content.innerHTML=gachaViews.data(state,loadedAccounts,counts);
    for(const game of ['hk4e','hkrpg'].filter(game=>localData?.failed(game))){
      ui.content.insertAdjacentHTML('beforeend',`<div class="empty"><p>${gachaModel.games[game].label}记录读取失败。</p><button class="secondary" data-retry-game="${game}">重试读取${gachaModel.games[game].label}</button></div>`);
    }
  }
  const countIndexes=new WeakMap();
  function accountCounts(){const result={};for(const game of ['hk4e','hkrpg'])if(localData?.has(game)){const dataset=state.datasets[game];let counts=countIndexes.get(dataset);if(!counts){counts={};for(const account of dataset.accounts)counts[game+':'+account.uid]=0;for(const record of dataset.records){const key=game+':'+record.uid;counts[key]=(counts[key]||0)+1;}countIndexes.set(dataset,counts);}Object.assign(result,counts);}return result;}
  function transferSteps(){return `<ol class="transfer-steps"><li class="${state.transferStage==='select'?'active':''}">1 · 选择账号</li><li class="${state.transferStage==='review'?'active':''}">2 · 核对范围</li><li class="${state.transferStage==='result'?'active':''}">3 · 执行结果</li></ol>`;}
  function exportReady(){return state.exportKeys.length>0&&state.exportKeys.every(key=>localData?.has(key.split(':')[0]));}
  function renderExport(){
    const allAccounts=accounts(),counts=accountCounts(),bundles=gachaPresentation.exportBundles(state.datasets,allAccounts,state.exportKeys),count=bundles.reduce((sum,item)=>sum+item.records.length,0);
    if(state.transferStage==='result'){ui.content.innerHTML=transferSteps()+gachaViews.intro('副本已保存','导出完成',`${state.transferResult.accounts} 个账号 · ${state.transferResult.records} 条记录`)+gachaViews.footnote('文件只包含所选账号的抽卡记录，不包含登录状态和访问凭据。');return;}
    ui.content.innerHTML=transferSteps()+gachaViews.intro('保存一份 UIGF 副本',state.transferStage==='review'?'核对导出范围':'选择要导出的账号','文件可以在支持 UIGF 的记录工具之间迁移。')+(state.transferStage==='review'?`<section class="wish-panel"><h3>UIGF v4.2</h3><p>${bundles.length} 个账号 · ${count} 条记录</p>${bundles.map(item=>`<p>${gachaModel.games[item.account.game].label} · ${esc(item.account.uid)} · ${item.records.length} 条</p>`).join('')}</section><div class="wish-flow-footer"><p class="supporting">选择保存位置后才会生成文件。</p><div class="actions"><button id="transfer-edit" class="secondary">返回修改范围</button><button id="save-export" ${exportReady()?'':'disabled'}>选择位置并保存</button></div></div>`:`<div class="wish-choices">${gachaViews.accountChoices(allAccounts,state.exportKeys,counts,'export-account')||gachaViews.empty('没有可导出的账号','请先获取或导入记录。')}</div>${allAccounts.some(account=>!localData?.has(account.game))?'<p class="supporting">未读取成功的账号暂不可导出。请在数据页单独重试，或取消选择这些账号。</p>':''}<div class="wish-flow-footer"><p id="transfer-summary" class="supporting">${state.exportKeys.length} 个账号已选择</p><button id="transfer-next" ${exportReady()?'':'disabled'}>核对导出范围</button></div>`);
  }
  function selectedImportBundles(){return (pendingImportBundles||[]).filter(bundle=>state.importKeys.includes(gachaModel.key(bundle.account)));}
  function renderImport(){
    if(state.transferStage==='result'){ui.content.innerHTML=transferSteps()+gachaViews.intro('文件已合并','导入完成',`新增 ${state.transferResult.inserted} 条 · 重复 ${state.transferResult.skipped} 条 · 补全 ${state.transferResult.enriched||0} 条 · 冲突 ${state.transferResult.conflicted||0} 条`)+gachaViews.footnote('原有历史已保留，可以返回总览切换账号查看。');return;}
    const bundles=pendingImportBundles||[],accountMap=new Map(bundles.map(bundle=>[gachaModel.key(bundle.account),bundle.account])),counts={};for(const bundle of bundles)counts[gachaModel.key(bundle.account)]=(counts[gachaModel.key(bundle.account)]||0)+bundle.records.length;
    pendingImportPlan=gachaPresentation.importPlan(state.datasets,selectedImportBundles());
    ui.content.innerHTML=transferSteps()+gachaViews.intro('从文件合并历史',state.transferStage==='review'?'确认将要合并的记录':'选择要导入的账号','按游戏、账号、卡池和记录 ID 合并，原有记录保留。')+(state.transferStage==='review'?`<section class="wish-panel">${pendingImportPlan.map(item=>`<div class="import-game"><h3>${gachaModel.games[item.game].label}</h3><p>${item.accounts} 个账号 · 新增 ${item.inserted} 条 · 重复 ${item.skipped} 条 · 补全 ${item.enriched} 条 · 冲突 ${item.conflicted} 条</p></div>`).join('')}</section><div class="wish-flow-footer"><p class="supporting">确认前不会写入本地记录。</p><div class="actions"><button class="secondary" id="transfer-edit">返回修改范围</button><button id="confirm-import" ${state.importKeys.length?'':'disabled'}>确认合并记录</button></div></div>`:`<div class="wish-choices">${gachaViews.accountChoices([...accountMap.values()],state.importKeys,counts,'import-account')}</div><div class="wish-flow-footer"><p id="transfer-summary" class="supporting">${state.importKeys.length} 个账号已选择</p><button id="transfer-next" ${state.importKeys.length?'':'disabled'}>核对新增与重复数量</button></div>`);
  }
  function updateTransferSelection(){const exporting=state.view?.kind==='export',keys=exporting?state.exportKeys:state.importKeys;byId('transfer-summary').textContent=`${keys.length} 个账号已选择`;byId('transfer-next').disabled=state.busy||(exporting?!exportReady():!keys.length);}
  function renderAccount(){
    const account=accounts().find(item=>gachaModel.key(item)===state.view.key);if(!account){ui.content.innerHTML=gachaViews.empty('本地账号不存在','记录已变化，请返回账号管理。');return;}
    const key=state.view.key,note=preference('account-note:'+key,''),draft=state.accountDraft?.key===key?state.accountDraft.value:note,count=accountCounts()[key];
    ui.content.innerHTML=`<section class="wish-panel account-identity"><div class="wish-account-heading"><span class="wish-game-icon">${account.game==='hk4e'?'原':'星'}</span><div class="grow"><h3>${esc(note||'UID '+account.uid)}</h3><p>${gachaModel.games[account.game].label}</p></div></div><dl class="account-facts">${note?`<div><dt>UID</dt><dd>${esc(account.uid)}</dd></div>`:''}<div><dt>本地记录</dt><dd>${count==null?'尚未读取':count+' 条'}</dd></div></dl></section><section class="wish-panel account-note-form"><p class="supporting">备注只用于区分本机档案，不改变游戏昵称。</p><label for="account-note">账号备注<input id="account-note" maxlength="80" value="${esc(draft)}" placeholder="例如：主账号、国际服小号"></label><div class="account-form-actions"><button id="save-note" disabled>保存备注</button></div></section><section class="account-record-actions"><button id="account-records" class="secondary browse-action">查看此账号记录</button><button id="account-export" class="text-button">导出此账号 UIGF</button></section>${gachaViews.footnote('UIGF 只包含记录。完整备份位于应用数据管理；范围删除从账号管理选择。')}`;
  }
  function updateAccountNoteForm(){const button=byId('save-note');if(button)button.disabled=state.busy||!accountNoteDirty();}
  async function saveAccountNote(){
    if(state.busy)return;const operation=operationReports.start('保存账号备注');const key=state.view.key,note=byId('account-note').value.trim(),settings=JSON.parse(JSON.stringify(state.settings));settings.preferences||={};settings.preferences['account-note:'+key]={type:'string',value:note};setBusy(true);
    try{await saveSettings(settings);operation.success('账号备注已保存');state.settings=settings;state.accountDraft={key,value:note};render();notice('账号备注已保存','success');}catch(error){operation.fail();notice(error.message,'danger');}finally{setBusy(false);}
  }
  async function deleteAccount(key){
    if(state.busy)return;const account=accounts().find(item=>gachaModel.key(item)===key);if(!account)return;const operation=operationReports.start('删除本地账号数据');setBusy(true);
    try{await localData.ensure(account.game);const candidate=JSON.parse(JSON.stringify(state.datasets[account.game]));candidate.accounts=candidate.accounts.filter(item=>item.uid!==account.uid);candidate.records=candidate.records.filter(item=>item.uid!==account.uid);candidate.poolSyncState=candidate.poolSyncState.filter(item=>item.uid!==account.uid);await ats.writeDataset(account.game==='hk4e'?'genshin-records':'starrail-records',encoder.encode(JSON.stringify(candidate)),{accounts:candidate.accounts.length,records:candidate.records.length});operation.success('本地账号数据已删除');state.datasets[account.game]=candidate;selectInitial();backView(true);notice('已删除这个账号的本地记录','success');}
    catch(error){operation.fail();notice(error.message,'danger');}finally{setBusy(false);}
  }
  function openDistributionFilters(){
    distributionDraft=JSON.parse(JSON.stringify(state.distributionFilter));
    drawDistributionFilters();document.getElementById('distribution-filters').showModal();backNavigation.sync();
  }
  function drawDistributionFilters(){
    const result=gachaDistribution.compute(state,state.distributionFilter),target=document.getElementById('distribution-filter-content');
    const option=(item,key)=>'<label class="selection-row"><input type="checkbox" data-distribution-filter="'+key+'" value="'+esc(item.id)+'" '+(distributionDraft[key].includes(item.id)?'checked':'')+'><span>'+esc(item.label)+'</span></label>';
    target.innerHTML=[...new Set(result.resources.map(asset=>asset.family))].map(family=>'<section class="distribution-filter-group"><h3>'+esc(family)+'</h3>'+result.resources.filter(asset=>asset.family===family).map(asset=>'<div class="distribution-filter-resource">'+option(asset,'resources')+'<div class="distribution-filter-pools">'+result.pools.filter(pool=>pool.resource===asset.id).map(pool=>option(pool,'pools')).join('')+'</div></div>').join('')+'</section>').join('')+'<p class="supporting">不选时显示全部，票券与卡池条件同时生效。</p>';
    target.querySelectorAll('[data-distribution-filter]').forEach(input=>input.onchange=()=>{const key=input.dataset.distributionFilter;distributionDraft[key]=input.checked?[...new Set([...distributionDraft[key],input.value])]:distributionDraft[key].filter(value=>value!==input.value);});
  }
  document.getElementById('distribution-filter-close').onclick=()=>document.getElementById('distribution-filters').close();
  document.getElementById('distribution-filter-apply').onclick=()=>{state.distributionFilter=distributionDraft;document.getElementById('distribution-filters').close();render();};
  document.getElementById('distribution-filter-reset').onclick=()=>{distributionDraft={mode:state.distributionFilter.mode,resources:[],pools:[]};drawDistributionFilters();};
  function bind(){
    all('[data-update-reference]').forEach(button=>button.onclick=()=>updateReference(button.dataset.updateReference));
    byId('reference-auto-check')?.addEventListener('change',event=>setReferenceAutoCheck(event.target.checked));
    byId('open-distribution-filters')?.addEventListener('click',openDistributionFilters);
    all('[data-distribution-mode]').forEach(button=>button.onclick=()=>{state.distributionFilter={...state.distributionFilter,mode:button.dataset.distributionMode};render();});
    all('[data-distribution-index]').forEach(button=>button.onclick=()=>{const filter=state.distributionFilter,group=gachaDistribution.compute(state,filter).groups[Number(button.dataset.distributionIndex)];if(group)openDistributionSummary(filter,group.key,group.label);});
    all('[data-summary-chart]').forEach(button=>button.onclick=()=>{state.view.chart=button.dataset.summaryChart;render();});
    all('[data-summary-records]').forEach(button=>button.onclick=()=>showDistributionRecords(Number(button.dataset.summaryRecords)));

    byId('search')?.addEventListener('input',event=>{state.query=event.target.value;state.recordPage=0;applyFilters();});
    byId('record-pool')?.addEventListener('change',event=>{state.pool=event.target.value;state.recordPage=0;applyFilters();});
    byId('record-rarity')?.addEventListener('change',event=>{state.rarity=Number(event.target.value);state.recordPage=0;applyFilters();});
    byId('clear-filters')?.addEventListener('click',()=>showRecords());
    all('[data-open-pool]').forEach(button=>button.onclick=()=>openView('pool',button.dataset.openPool));
    all('[data-records-pool]').forEach(button=>button.onclick=()=>showRecords(button.dataset.recordsPool,button.dataset.recordsRarity||0));
    all('[data-month]').forEach(button=>button.onclick=()=>openDistributionSummary({mode:'month',resources:[],pools:[]},button.dataset.month,button.dataset.month));
    all('[data-detail-filter]').forEach(button=>button.onclick=()=>{state.detailFilter=button.dataset.detailFilter;render();});
    all('[data-view]').forEach(button=>button.onclick=()=>openView(button.dataset.view));
    all('.go-acquire,.go-data').forEach(button=>button.onclick=()=>button.classList.contains('go-data')?openView('data'):openAcquireView());
    all('[data-select-account]').forEach(button=>button.onclick=()=>selectAccount(button.dataset.selectAccount));
    all('.delete-account-choice').forEach(input=>input.onchange=()=>{state.deleteKeys=[...all('.delete-account-choice:checked')].map(item=>item.value);const button=byId('delete-selected');button.disabled=!state.deleteKeys.length;byId('delete-summary').textContent=`已选择 ${state.deleteKeys.length} 个账号`;});
    byId('delete-selected')?.addEventListener('click',()=>confirmAction('删除所选账号的记录？',`将永久删除 ${state.deleteKeys.length} 个账号的本地记录。其他账号、统计设置和米游社登录状态保留。`,'删除所选记录',()=>deleteSelectedAccounts([...state.deleteKeys])));
    all('[data-account-actions]').forEach(button=>button.onclick=()=>openView('account',button.dataset.accountActions));
    all('[data-retry-game]').forEach(button=>button.onclick=async()=>{setBusy(true);try{await localData.ensure(button.dataset.retryGame);}catch(error){notice(error.message,'danger');}finally{selectInitial();render();setBusy(false);}});
    bindRecordRows();
    byId('link')?.addEventListener('input',event=>{state.linkDraft=event.target.value;state.link=null;byId('link-status').textContent=state.linkDraft.trim()?'点击“获取新记录”开始读取':'粘贴链接，或使用设备日志与米游社获取';setBusy(state.busy);});
    byId('clear-link')?.addEventListener('click',()=>{if(state.link){preparedLinks.delete(state.link.game);cachedLinks().remove(state.link).catch(()=>notice('链接缓存未能清除，请重试','danger'));}state.cachedLink=false;state.cacheWarning='';state.link=null;state.linkDraft='';state.lastSync=null;render();byId('link')?.focus();});
    byId('clipboard')?.addEventListener('click',async()=>{try{const value=await ats.call('clipboard.read',{});readLink(value.text);}catch(error){notice(error.message,'danger');}});
    byId('copy')?.addEventListener('click',async()=>{if(!state.link)return;try{await ats.call('clipboard.write',{text:gachaModel.requestUrl(state.link,gachaModel.games[state.link.game].pools[0]).toString()});notice('链接已复制，请勿发送给不可信的人','success');}catch(error){notice(error.message,'danger');}});
    byId('find-log')?.addEventListener('click',()=>fromLogs(byId('log-game').value));
    byId('log-game')?.addEventListener('change',event=>{state.logGame=event.target.value;});
    byId('log-range')?.addEventListener('change',event=>{state.logRange=Number(event.target.value);setPreference('log-lookback-minutes','int',state.logRange);saveSettings().catch(error=>notice(error.message,'danger'));});
    byId('mihoyo-login')?.addEventListener('click',startMihoyoLogin);byId('mihoyo-cancel')?.addEventListener('click',cancelMihoyoLogin);
    byId('mihoyo-roles')?.addEventListener('click',()=>loadMihoyoRoles(state.mihoyoCookie,true));byId('mihoyo-logout')?.addEventListener('click',()=>{state.pendingLogout=true;render();});
    byId('confirm-logout')?.addEventListener('click',logoutMihoyo);byId('cancel-logout')?.addEventListener('click',()=>{state.pendingLogout=false;render();});
    all('.mihoyo-role').forEach(button=>button.onclick=()=>useMihoyoRole(Number(button.dataset.index)));
    byId('view-records')?.addEventListener('click',()=>showRecords());byId('sync')?.addEventListener('click',()=>sync());byId('sync-full')?.addEventListener('click',()=>sync('full'));
    byId('import')?.addEventListener('click',importUigf);byId('export')?.addEventListener('click',()=>{state.transferStage='select';openView('export');});
    all('.delete-game').forEach(button=>button.onclick=()=>confirmAction(`删除${gachaModel.games[button.dataset.game].label}记录？`,'该游戏所有账号及记录将从本机删除，另一游戏和米游社登录状态不受影响。','删除本地记录',()=>deleteGame(button.dataset.game)));
    all('.source-option').forEach(input=>input.addEventListener('change',updateAnalysisDraft));byId('custom-loss')?.addEventListener('input',updateAnalysisDraft);byId('save-analysis')?.addEventListener('click',saveAnalysis);
    all('.export-account').forEach(input=>input.addEventListener('change',()=>{state.exportKeys=[...all('.export-account:checked')].map(item=>item.value);updateTransferSelection();}));
    all('.import-account').forEach(input=>input.addEventListener('change',()=>{state.importKeys=[...all('.import-account:checked')].map(item=>item.value);updateTransferSelection();}));
    byId('transfer-next')?.addEventListener('click',()=>{state.transferStage='review';render();});
    byId('transfer-edit')?.addEventListener('click',()=>{state.transferStage='select';render();});
    byId('confirm-import')?.addEventListener('click',confirmImport);byId('save-export')?.addEventListener('click',exportUigf);
    byId('save-note')?.addEventListener('click',saveAccountNote);
    byId('account-note')?.addEventListener('input',event=>{state.accountDraft={key:state.view.key,value:event.target.value};updateAccountNoteForm();});
    byId('account-records')?.addEventListener('click',()=>{const key=state.view.key;const show=async()=>{state.accountDraft=null;await selectAccount(key);if(state.selected&&gachaModel.key(state.selected)===key)showRecords();};if(accountNoteDirty())confirmAction('放弃未保存的备注？','已经保存的备注与记录不会改变。','放弃并查看记录',show);else show();});
    updateAccountNoteForm();
    byId('account-export')?.addEventListener('click',()=>{const key=state.view.key;state.transferStage='select';openView('export');state.exportKeys=[key];render();});
    byId('account-delete')?.addEventListener('click',()=>{const key=state.view.key;confirmAction('删除这个本地账号？','删除此账号的所有本地抽卡记录，其他账号和米游社登录状态保留。','删除此账号',()=>deleteAccount(key));});
    renderMihoyoQr();setBusy(state.busy);
  }
  const recordScopes=new WeakMap();
  function applyFilters(){
    if(state.view?.kind!=='records'&&state.page!=='记录')return;
    const list=byId('record-list');if(!list)return;
    let scope=state.snapshot;if(state.recordDrill){const reference=window.gachaReference?.active(state.selected.game);let cached=recordScopes.get(state.recordDrill);if(!cached||cached.source!==state.snapshot||cached.reference!==reference){const group=gachaDistribution.compute(state,state.recordDrill.filter).groups.find(item=>item.key===state.recordDrill.key);cached={source:state.snapshot,reference,snapshot:{records:group?.records||[]}};recordScopes.set(state.recordDrill,cached);}scope=cached.snapshot;}
    const records=gachaPresentation.records(scope,state.selected?.game,state.query,state.pool,state.rarity),pages=Math.max(1,Math.ceil(records.length/50));
    state.recordPage=Math.min(state.recordPage,pages-1);byId('record-count').textContent=`${records.length} 条匹配记录`;
    list.innerHTML=gachaPresentation.dateGroups(records.slice(state.recordPage*50,(state.recordPage+1)*50)).map(group=>`<section class="wish-date-group"><h3 class="wish-date">${esc(group.date)}</h3>${group.records.map(item=>gachaViews.recordRow(state,item)).join('')}</section>`).join('')||'<div class="empty">没有符合筛选条件的记录。</div>';
    byId('record-pager').innerHTML=`<button id="previous-records" class="secondary browse-action" ${state.recordPage?'':'disabled'}>上一页</button><span>${state.recordPage+1} / ${pages}</span><button id="next-records" class="secondary browse-action" ${state.recordPage+1<pages?'':'disabled'}>下一页</button>`;
    byId('previous-records').onclick=()=>{state.recordPage--;applyFilters();ui.content.closest('.tab-page')?.scrollTo({top:0});};
    byId('next-records').onclick=()=>{state.recordPage++;applyFilters();ui.content.closest('.tab-page')?.scrollTo({top:0});};
    const clear=byId('clear-filters');if(clear)clear.hidden=!(state.query||state.pool!=='all'||state.rarity||state.recordDrill);
    bindRecordRows();
  }
  function readLink(raw){try{state.link=gachaModel.parseLink(raw);state.linkDraft='';state.lastSync=null;cachePreparedLink();notice(`${gachaModel.games[state.link.game].label}链接已就绪，点击“获取新记录”开始`,'success');render();focusLink();}catch(error){notice(error.message,'danger');}}
  function focusLink(){requestAnimationFrame(()=>byId('link-panel')?.scrollIntoView({block:'start',behavior:'smooth'}));}
  async function fromLogs(game){const operation=operationReports.start('查找设备抽卡链接');setBusy(true);try{state.link=await gachaNetwork.fromSystemLogs(game,0);await cachePreparedLink();operation.success('链接已准备好，可继续获取记录');state.acquireSource='link';state.linkDraft='';state.lastSync=null;notice('链接已就绪，点击“获取新记录”开始','success');render();focusLink();}catch(error){operation.fail();notice(error.message,'danger');}finally{setBusy(false);}}
  function renderMihoyoQr(){const target=byId('mihoyo-qr');if(!target||!state.mihoyoQr||typeof qrcode!=='function')return;try{const code=qrcode(0,'M');code.addData(state.mihoyoQr.loginUrl);code.make();target.innerHTML=code.createSvgTag({cellSize:5,margin:2,scalable:true});}catch(_){target.textContent='二维码生成失败，请重新创建';}}
  async function persistMihoyo(cookie){state.mihoyoCookie=cookie;await ats.call('storage.secret.set',{datasetId:'mihoyo-session',key:'cookie',value:cookie});await ats.writeDataset('mihoyo-session',encoder.encode(JSON.stringify({formatVersion:1,session:cookie})));}
  function cancelMihoyoLogin(){mihoyoLoginOperation?.cancel();mihoyoLoginOperation=null;state.mihoyoQr=null;state.mihoyoQrStatus='';render();}
  async function startMihoyoLogin(){
    mihoyoLoginOperation?.cancel();const operation=operationReports.start('米游社扫码登录');mihoyoLoginOperation=operation;
    setBusy(true);state.mihoyoQr=null;
    try{state.mihoyoQr=await mihoyo.createQrSession();state.mihoyoQrStatus='等待米游社扫码确认';notice('二维码已创建，请使用米游社扫码并确认','success');render();setTimeout(pollMihoyoLogin,1500);}
    catch(error){operation.fail();if(mihoyoLoginOperation===operation)mihoyoLoginOperation=null;notice(error.message,'danger');}finally{setBusy(false);}
  }
  async function pollMihoyoLogin(){
    const session=state.mihoyoQr,operation=mihoyoLoginOperation;if(!session)return;
    try{
      const result=await mihoyo.pollQrSession(session);if(state.mihoyoQr!==session)return;
      if(result.status==='Confirmed'){await persistMihoyo(result.cookie);operation?.success('登录状态已保存');if(mihoyoLoginOperation===operation)mihoyoLoginOperation=null;state.mihoyoQr=null;state.mihoyoQrStatus='';await loadMihoyoRoles(result.cookie);return;}
      state.mihoyoQrStatus=result.status==='Scanned'?'已扫码，请在米游社中确认登录':'等待米游社扫码确认';render();setTimeout(pollMihoyoLogin,1500);
    }catch(error){if(state.mihoyoQr!==session)return;operation?.fail();if(mihoyoLoginOperation===operation)mihoyoLoginOperation=null;state.mihoyoQr=null;state.mihoyoQrStatus='';notice(error.message,'danger');render();}
  }
  async function loadMihoyoRoles(rawCookie,reportOperation=false){
    if(!rawCookie?.trim()){notice('请先扫码登录','danger');return;}
    const operation=reportOperation?operationReports.start('刷新米游社角色'):null;setBusy(true);
    try{const result=await mihoyo.loadRoles(rawCookie);await persistMihoyo(result.cookie);operation?.success('角色资料已更新');state.mihoyoRoles=result.roles;state.mihoyoRolesLoaded=true;notice('已读取米游社角色；国服原神角色可直接生成链接','success');render();}
    catch(error){operation?.fail();notice(error.message,'danger');}finally{setBusy(false);}
  }
  async function useMihoyoRole(index){
    const role=state.mihoyoRoles.filter(item=>item.game==='hk4e')[index];if(!role||!state.mihoyoCookie)return;
    const operation=operationReports.start('获取角色抽卡链接');setBusy(true);
    try{state.link=await mihoyo.generateLink(state.mihoyoCookie,role);await cachePreparedLink(role.uid);operation.success('链接已准备好，可继续获取记录');state.acquireSource='link';state.linkDraft='';state.lastSync=null;notice('角色链接已就绪，点击“获取新记录”开始','success');render();focusLink();}
    catch(error){operation.fail();notice(error.message,'danger');}finally{setBusy(false);}
  }
  async function logoutMihoyo(){
    const operation=operationReports.start('退出米游社登录');setBusy(true);
    try{state.pendingLogout=false;state.mihoyoCookie=null;state.mihoyoRoles=[];state.mihoyoRolesLoaded=false;state.mihoyoQr=null;mihoyoLoginOperation?.cancel();mihoyoLoginOperation=null;await ats.call('storage.secret.delete',{datasetId:'mihoyo-session',key:'cookie'});await ats.call('storage.dataset.delete',{datasetId:'mihoyo-session'});operation.success('本机登录状态已删除，抽卡记录保留');notice('已退出米游社并删除本机登录状态','success');render();}
    catch(error){operation.fail();notice(error.message,'danger');}finally{setBusy(false);}
  }
  async function sync(mode='incremental') {
    const operation=operationReports.start(mode==='full'?'刷新全部抽卡记录':'获取新抽卡记录');
    setBusy(true);
    try {
      if(state.linkDraft.trim()){state.link=gachaModel.parseLink(state.linkDraft);state.cachedLink=false;state.cachedLinkUid=null;state.cacheWarning='';}
      if(!state.link)throw new Error('请先粘贴链接，或选择一种方式获取链接');
      const game=state.link.game;await localData.ensure(game);const dataset=state.datasets[game];state.linkDraft='';state.syncMode=mode;state.syncProgress='正在连接记录服务…';render();
      const bundle=await gachaNetwork.fetch(state.link,dataset,value=>{state.syncProgress=value;const progress=byId('sync-progress');if(progress)progress.textContent=value;},{mode});
      // Only publish the in-memory snapshot after the Dataset commit has succeeded.
      const candidate=JSON.parse(JSON.stringify(dataset)),result=gachaModel.mergeDataset(candidate,[bundle]);
      await ats.writeDataset(game==='hk4e'?'genshin-records':'starrail-records',encoder.encode(JSON.stringify(candidate)),{accounts:candidate.accounts.length,records:candidate.records.length});
      await cachePreparedLink(bundle.account.uid);state.datasets[game]=candidate;state.linkDraft='';state.selected=bundle.account;selectInitial();state.lastSync={mode,inserted:result.inserted,scanned:bundle.scannedRecords,uid:bundle.account.uid,time:new Date().toLocaleTimeString()};
      state.lastSync.enriched=result.enriched;state.lastSync.conflicted=result.conflicted;
      operation.success(`新增 ${result.inserted} 条，检查 ${bundle.scannedRecords} 条`+(result.enriched||result.conflicted?`，补全 ${result.enriched} 条，冲突 ${result.conflicted} 条`:''));
      notice(`${mode==='full'?'全部刷新':'增量获取'}完成：新增 ${result.inserted} 条，补全 ${result.enriched} 条，冲突 ${result.conflicted} 条；检查 ${bundle.scannedRecords} 条`,'success');
      state.syncMode=null;state.syncProgress='';render();
    }catch(error){if(gachaLinkCache.expired(error)&&state.link){preparedLinks.delete(state.link.game);await cachedLinks().remove(state.link).catch(()=>{});state.link=null;state.cachedLink=false;state.cacheWarning='';}operation.fail();notice(error.message,'danger');}finally{state.syncMode=null;state.syncProgress='';setBusy(false);const progress=byId('sync-progress');if(progress)progress.hidden=true;}
  }
  async function importUigf(){
    if(state.busy)return;const operation=operationReports.start('读取 UIGF 文件');setBusy(true);let blobId;
    try{
      const picked=await ats.call('file.import.pick',{mimeTypes:['application/json','text/plain']}),file=picked.files?.[0];
      if(!file){operation.cancel();notice('已取消选择文件');return;}blobId=file.blobId;
      const bytes=await ats.readBlob(blobId),bundles=uigf.decode(decoder.decode(bytes));
      await Promise.all([...new Set(bundles.map(bundle=>bundle.account.game))].map(game=>localData.ensure(game)));
      if(!bundles.length)throw new Error('文件中没有可导入的有效账号');
      pendingImportBundles=bundles;state.importKeys=[...new Set(bundles.map(bundle=>gachaModel.key(bundle.account)))];state.transferStage='select';state.transferResult=null;
      operation.success('文件已读取，请核对导入范围');openView('import');
    }catch(error){pendingImportPlan=null;pendingImportBundles=null;if(error.code==='CANCELLED'){operation.cancel();notice('已取消选择文件');}else{operation.fail();notice(error.message,'danger');}}
    finally{if(blobId)await ats.call('storage.blob.delete',{id:blobId}).catch(()=>{});setBusy(false);}
  }
  async function confirmImport(){
    if(state.busy||!pendingImportBundles||!state.importKeys.length)return;
    const operation=operationReports.start('导入 UIGF 记录'),completed=[];let inserted=0,skipped=0,enriched=0,conflicted=0;setBusy(true);
    try{
      // Let the already-ready RPC enqueue running before preparing a potentially large merge.
      await Promise.resolve();
      const plan=gachaPresentation.importPlan(state.datasets,selectedImportBundles());
      for(const item of plan){
        await ats.writeDataset(item.game==='hk4e'?'genshin-records':'starrail-records',encoder.encode(JSON.stringify(item.candidate)),{accounts:item.candidate.accounts.length,records:item.candidate.records.length});
        state.datasets[item.game]=item.candidate;completed.push(gachaModel.games[item.game].label);inserted+=item.inserted;skipped+=item.skipped;enriched+=item.enriched;conflicted+=item.conflicted;
      }
      operation.success(`新增 ${inserted} 条，重复 ${skipped} 条`+(enriched||conflicted?`，补全 ${enriched} 条，冲突 ${conflicted} 条`:''));state.transferStage='result';state.transferResult={inserted,skipped,enriched,conflicted};pendingImportPlan=null;pendingImportBundles=null;
      notice(`导入完成：新增 ${inserted} 条，重复 ${skipped} 条，补全 ${enriched} 条，冲突 ${conflicted} 条`,'success');
    }catch(error){operation.fail();notice(`${completed.length?'已完成 '+completed.join('、')+'；':''}其余记录导入失败：${error.message}。可重试确认，已完成部分不会重复导入。`,'danger');}
    finally{selectInitial();render();setBusy(false);}
  }
  async function exportUigf(){
    if(state.busy||!exportReady())return;const operation=operationReports.start('导出 UIGF 记录');setBusy(true);let blob;
    try{
      // This is only a microtask yield; business work never waits for report acknowledgement.
      await Promise.resolve();
      const bundles=gachaPresentation.exportBundles(state.datasets,accounts(),state.exportKeys),bytes=encoder.encode(uigf.encode(bundles,window.gachaBuild?.version||'dev'));
      if(!bundles.length)throw Error('请至少选择一个账号');
      blob='export.uigf';await ats.writeBlob(blob,bytes);const result=await ats.call('file.export.save',{blobId:blob,fileName:gachaViews.exportFileName(),mimeType:'application/json'},600000);
      if(result?.cancelled||result?.canceled){operation.cancel();notice('已取消保存，导出范围已保留');return;}
      if(result?.saved!==true)throw Error('未收到文件保存成功的确认，请重试');
      state.transferResult={accounts:bundles.length,records:bundles.reduce((sum,item)=>sum+item.records.length,0)};state.transferStage='result';operation.success(`已保存 ${state.transferResult.accounts} 个账号的 ${state.transferResult.records} 条记录`);render();notice('UIGF 已保存','success');
    }catch(error){if(error.code==='CANCELLED'){operation.cancel();notice('已取消保存，导出范围已保留');}else{operation.fail();notice(error.message,'danger');}}finally{if(blob)await ats.call('storage.blob.delete',{id:blob}).catch(()=>{});setBusy(false);}
  }
  function renderDelete(){
    const known=accounts(),counts=accountCounts();
    ui.content.innerHTML=`<p class="supporting">先导出需要保留的记录，再选择要删除的账号。此操作不会退出米游社。</p><div class="wish-choices">${gachaViews.accountChoices(known,state.deleteKeys,counts,'delete-account-choice')||gachaViews.empty('没有可删除的账号','当前没有本地记录。')}</div><div class="wish-flow-footer"><p id="delete-summary">已选择 ${state.deleteKeys.length} 个账号</p><button id="delete-selected" class="danger" ${state.deleteKeys.length?'':'disabled'}>删除所选记录</button></div>`;
  }
  async function deleteSelectedAccounts(keys){
    if(state.busy||!keys.length)return;
    const chosen=accounts().filter(account=>keys.includes(gachaModel.key(account))),games=[...new Set(chosen.map(account=>account.game))];
    if(!chosen.length)return;
    const operation=operationReports.start('删除所选账号记录');let completed=0;setBusy(true);
    try{
      await Promise.all(games.map(game=>localData.ensure(game)));
      for(const game of games){
        const uids=new Set(chosen.filter(account=>account.game===game).map(account=>account.uid)),candidate=JSON.parse(JSON.stringify(state.datasets[game]));
        candidate.accounts=candidate.accounts.filter(account=>!uids.has(account.uid));candidate.records=candidate.records.filter(record=>!uids.has(record.uid));candidate.poolSyncState=candidate.poolSyncState.filter(item=>!uids.has(item.uid));
        await ats.writeDataset(game==='hk4e'?'genshin-records':'starrail-records',encoder.encode(JSON.stringify(candidate)),{accounts:candidate.accounts.length,records:candidate.records.length});
        state.datasets[game]=candidate;completed+=uids.size;
      }
      operation.success(`已删除 ${completed} 个账号的记录`);state.deleteKeys=[];backView(true);notice(`已删除 ${completed} 个账号的本地记录`,'success');
    }catch(error){operation.fail();notice(`${completed?`已删除 ${completed} 个账号，其余未完成。`:''}${error.message}`,'danger');}
    finally{selectInitial();state.deleteKeys=state.deleteKeys.filter(key=>accounts().some(account=>gachaModel.key(account)===key));render();setBusy(false);}
  }
  async function deleteGame(game){if(!game)return;const operation=operationReports.start('删除本地游戏记录');setBusy(true);try{await ats.call('storage.dataset.delete',{datasetId:game==='hk4e'?'genshin-records':'starrail-records'});operation.success('所选游戏的本地记录已删除');state.datasets[game]=empty(game);state.pendingDelete=null;state.selected=null;selectInitial();notice(`已删除${gachaModel.games[game].label}数据`,'success');render();}catch(error){operation.fail();notice(error.message,'danger');}finally{setBusy(false);}}
  async function saveSettings(settings=state.settings){await ats.writeDataset('gacha-settings',encoder.encode(JSON.stringify(settings)));}
  const backNavigation=createPluginBackNavigation({client:ats,document,canBack:()=>!!state.view,back:()=>backView()});
  document.getElementById('view-back').onclick=()=>backView();
  document.onpointerdown=event=>{const menu=one('.distribution-detail-menu[open]');if(menu&&!menu.contains(event.target))menu.open=false;};
  document.onkeydown=event=>{if(event.key==='Escape'&&closeDistributionMenu())event.preventDefault();};
  document.getElementById('close-accounts').onclick=()=>document.getElementById('accounts-dialog').close();
  document.getElementById('close-record').onclick=()=>document.getElementById('record-dialog').close();
  document.getElementById('cancel-action').onclick=()=>document.getElementById('confirm-dialog').close();
  document.getElementById('open-data').onclick=()=>{document.getElementById('accounts-dialog').close();openView('data');};
  ui.refresh.onclick=()=>{document.getElementById('accounts-dialog').close();load();};ats.onEvent('app.visibilityChanged',payload=>{if(payload.visible&&payload.widgetEntry)queueWidgetEntry(payload.widgetEntry);if(payload.visible&&!initializing)maybeUpdateReference();});(async()=>{const ready=await ats.ready;queueWidgetEntry(ready?.widgetEntry);await load();await applyWidgetEntry();maybeUpdateReference();})();
})();
