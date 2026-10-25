import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),samples=resolve(process.argv[2]||'../../temp/gacha-reference');
const context=vm.createContext({TextEncoder,TextDecoder,crypto:webcrypto,console});context.window=context;
for(const file of ['version-calendar','reference-history','reference-data'])vm.runInContext(readFileSync(resolve(root,`src/web/${file}.js`),'utf8'),context);
const ref=context.gachaReference,files={paimon:'banners.js',watcher:'banner-data.json',genshinItems:'official-config.json',genshinNames:'official-names.json',station:'warp_config.json',characters:'sr-characters.json',lightcones:'sr-lightcones.json',announcements:'ann-content.json',genshinCnAnnouncements:'cn-ann-content.json',starrailCnAnnouncements:'sr-cn-ann-content.json',genshinCnVersions:'cn-version-page.html',starrailCnVersions:'sr-version-page.html',genshinCnHistory:'history/genshin-wishes.html',genshinCnChronicle:'history/genshin-chronicle.html',starrailCnHistory:'history/starrail-history.html'};
const identities=JSON.parse(readFileSync(resolve(root,'metadata/starrail-cn-collaboration.json'),'utf8'));
const request=async url=>{let key=Object.keys(ref.urls).find(key=>ref.urls[key]===url),file=files[key];if(!file&&url.startsWith('https://wiki.biligame.com/sr/index.php?title=')){const name=new URL(url).searchParams.get('title'),items=JSON.parse(readFileSync(resolve(samples,'sr-characters.json'),'utf8')),cones=JSON.parse(readFileSync(resolve(samples,'sr-lightcones.json'),'utf8')),item=Object.values({...items,...cones}).find(item=>item.name===name);file=item?'history/profile-'+item.id+'.html':null;}if(!file)throw Error('Unexpected public source');const path=resolve(samples,file);try{return {status:200,text:readFileSync(path,'utf8'),observedAt:statSync(path).mtimeMs};}catch(error){if(error.code==='ENOENT')return {status:567,text:''};throw error;}};
const bundle={};
for(const game of ['hk4e','hkrpg'])bundle[game]=await ref.seal(await ref.candidate(request,game,game==='hkrpg'?{cnIdentitySeeds:identities}:null));
writeFileSync(resolve(root,'src/web/reference-bundle.js'),'// Public data only. Generated with tools/generate-reference-bundle.mjs; no player records.\nwindow.gachaReferenceBundle = '+JSON.stringify(bundle)+';\n');
writeFileSync(resolve(root,'metadata/reference-data-sources.lock.json'),JSON.stringify({schemaVersion:1,games:Object.fromEntries(Object.entries(bundle).map(([game,snapshot])=>[game,{revision:snapshot.revision,contentRevision:snapshot.contentRevision,banners:snapshot.banners.length,versions:snapshot.versions.length,sources:snapshot.sources,warnings:snapshot.warnings}]))},null,2)+'\n');
for(const [game,snapshot] of Object.entries(bundle))console.log(game,snapshot.banners.length,'banners',snapshot.versions.length,'versions',snapshot.warnings);
