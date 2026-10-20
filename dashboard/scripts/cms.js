/* Dashboard controller. Lists keep their canonical server order independently of views. */
(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
    const button = (text, fn) => { const n = el('button', text, 'cms-button'); n.type = 'button'; n.addEventListener('click', fn); return n; };
    const bytes = n => n == null ? 'Nicht erfasst' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
    const date = v => v && !Number.isNaN(new Date(v).getTime()) ? new Date(v).toLocaleString('de-DE') : 'Nicht erfasst';
    let pending = 0, editId = null, currentPath = '', active = '', timer;
    const baselines = new Map();
    const snapshot = f => JSON.stringify([...f.querySelectorAll('input:not([type=file]),textarea,select')].map(n => [n.id, n.type === 'checkbox' ? n.checked : n.value]));
    const markClean = f => baselines.set(f, snapshot(f));
    const dirty = () => [...baselines].some(([f, s]) => snapshot(f) !== s);
    const leave = () => !dirty() || confirm('Ungespeicherte Änderungen sind vorhanden. Bereich trotzdem wechseln? Die Eingaben bleiben bis zum Neuladen erhalten.');
    function notice(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(timer); timer = setTimeout(() => $('toast').hidden = true, 6000); }
    $('toast').setAttribute('role', 'status');
    async function api(url, method = 'GET', data) {
        const response = await fetch(url, { method, headers: data ? {'Content-Type':'application/json'} : {}, body: data ? JSON.stringify(data) : undefined });
        const value = await response.json().catch(() => null);
        if (!response.ok || value == null || response.redirected) throw new Error(value?.error || `Anfrage fehlgeschlagen (${response.status}). Bitte Anmeldung und Verbindung prüfen.`);
        return value;
    }
    async function run(host, fn, message = 'Gespeichert.') {
        if (host.dataset.busy) return;
        host.dataset.busy = '1'; host.setAttribute('aria-busy', 'true'); pending++;
        const controls = [...host.querySelectorAll('button,input,select,textarea')].map(n => [n, n.disabled]);
        controls.forEach(([n]) => n.disabled = true);
        const status = host.querySelector('.cms-status') || host.appendChild(el('p', '', 'cms-status'));
        status.setAttribute('role', 'status'); status.textContent = 'Wird verarbeitet …';
        try { await fn(); status.textContent = message; notice(message); }
        catch (error) { status.textContent = error.message; notice(error.message); }
        finally { controls.forEach(([n, disabled]) => n.disabled = disabled); delete host.dataset.busy; host.removeAttribute('aria-busy'); pending--; }
    }
    const dialog = el('dialog', null, 'cms-dialog');
    dialog.setAttribute('aria-labelledby', 'cms-dialog-title');
    document.body.append(dialog);
    function openDialog(title) {
        dialog.replaceChildren();
        const heading = el('h2', title); heading.id = 'cms-dialog-title'; dialog.append(heading, button('Schließen', () => dialog.close()));
        dialog.showModal(); return dialog;
    }
    dialog.addEventListener('close', () => dialog.replaceChildren());
    function safeUrl(value) {
        const url = new URL(value, location.origin);
        if (url.origin !== location.origin || !url.pathname.startsWith('/uploads/')) throw new Error('Keine sichere Vorschau-URL verfügbar.');
        return url.href;
    }
    function preview(name, urls) {
        const box = openDialog(name);
        if (!urls.length) { box.append(el('p', 'Keine Vorschauseiten vorhanden.')); return; }
        let index = 0;
        const nav = el('div', null, 'cms-tools'), stage = el('div'), count = el('span');
        const prev = button('Vorherige Seite', () => { index--; render(); });
        const next = button('Nächste Seite', () => { index++; render(); });
        nav.append(prev, count, next); box.append(nav, stage);
        function render() {
            stage.replaceChildren(); count.textContent = `Seite ${index + 1} / ${urls.length}`; prev.disabled = !index; next.disabled = index === urls.length - 1;
            try {
                const url = safeUrl(urls[index]);
                if (/\.(png|jpe?g|gif|webp|bmp|avif|svg)(?:[?#]|$)/i.test(url)) { const img = el('img'); img.src = url; img.alt = `${name}, Seite ${index + 1}`; stage.append(img); }
                else if (/\.pdf(?:[?#]|$)/i.test(url)) { const frame = el('iframe'); frame.setAttribute('sandbox', ''); frame.title = name; frame.src = url; stage.append(frame, el('p', 'Falls der Browser PDF-Vorschauen blockiert, die Datei herunterladen.')); }
                else stage.append(el('p', 'Für diesen Dateityp ist keine Vorschau verfügbar.'));
                const download = el('a', 'Datei herunterladen'); download.href = url; download.download = name; stage.append(download);
            } catch (error) { stage.append(el('p', error.message)); }
        }
        render();
    }
    function rename(list, item) {
        const box = openDialog('Umbenennen'), form = el('form'), label = el('label', 'Neuer Name'), input = el('input');
        input.id = 'cms-new-name'; label.htmlFor = input.id; input.value = item.name; input.required = true;
        const save = button('Speichern', () => {}); save.type = 'submit'; form.append(label, input, save); box.append(form); input.focus();
        form.addEventListener('submit', e => { e.preventDefault(); const name = input.value.trim(); if (!name) return;
            run(form, async () => { await api(list.url + (list.key === 'file' ? '' : '/' + encodeURIComponent(item.id)), 'PUT', list.key === 'file' ? {path:currentPath,name:item.name,newName:name} : {name}); dialog.close(); await list.load(); });
        });
    }
    class Listing {
        constructor(key, url, columns, actions, selectable = true) {
            Object.assign(this, {key,url,columns,actions,selectable,items:[],selected:new Set(),page:1,sort:-1,direction:1,sequence:0});
            this.body = $(key + '-tbody'); this.table = this.body.closest('table'); this.host = this.table.parentElement;
            this.tools = el('div', null, 'cms-tools'); this.search = el('input'); this.search.type = 'search'; this.search.placeholder = 'Suchen …'; this.search.setAttribute('aria-label', 'Inhalte durchsuchen');
            this.search.addEventListener('input', () => { this.page = 1; this.render(); });
            this.size = el('select'); this.size.setAttribute('aria-label', 'Einträge pro Seite'); [10,25,50,100].forEach(n => this.size.add(new Option(`${n} pro Seite`, n)));
            this.size.addEventListener('change', () => { this.page = 1; this.render(); });
            this.tools.append(this.search,this.size,button('Aktualisieren', () => this.load()));
            if (selectable) { this.bulk = button('Auswahl löschen', () => this.remove([...this.selected])); this.tools.append(this.bulk); }
            this.host.insertBefore(this.tools, this.table);
            const scroll = el('div', null, 'cms-table-scroll'); this.table.before(scroll); scroll.append(this.table);
            this.pager = el('div', null, 'cms-tools'); this.prev = button('Zurück', () => {this.page--;this.render();}); this.next = button('Weiter', () => {this.page++;this.render();}); this.info = el('span'); this.info.setAttribute('aria-live','polite');
            this.pager.append(this.prev,this.info,this.next); this.status = el('p', '', 'cms-status'); this.status.setAttribute('role','status'); this.host.append(this.pager,this.status);
            this.header();
        }
        id(item) { return String(this.key === 'file' ? item.name : item.id); }
        header() {
            const tr = el('tr');
            if (this.selectable) { const th = el('th'); this.all = el('input'); this.all.type = 'checkbox'; this.all.setAttribute('aria-label','Alle Einträge auf dieser Seite auswählen'); this.all.addEventListener('change', () => { this.visible.filter(x => !x.folder).forEach(x => this.all.checked ? this.selected.add(this.id(x)) : this.selected.delete(this.id(x))); this.render(); }); th.append(this.all); tr.append(th); }
            this.columns.forEach(([label], i) => { const th = el('th'); th.setAttribute('aria-sort', this.sort === i ? this.direction === 1 ? 'ascending' : 'descending' : 'none'); th.append(button(label + (this.sort === i ? this.direction === 1 ? ' ↑' : ' ↓' : ''), () => {this.direction = this.sort === i ? -this.direction : 1; this.sort = i;this.page=1;this.render();this.table.tHead.querySelectorAll('button')[i].focus();})); tr.append(th); }); tr.append(el('th','Aktionen')); this.table.tHead.replaceChildren(tr);
        }
        async load() {
            const seq = ++this.sequence; this.status.textContent = 'Wird geladen …'; this.table.setAttribute('aria-busy','true');
            try {
                const data = await api(this.url + (this.key === 'file' ? '?path=' + encodeURIComponent(currentPath) : ''));
                if (seq !== this.sequence) return;
                this.items = this.key === 'file' ? [...data.ordner.map(name => ({name,folder:true,type:'Ordner'})), ...data.dateien] : Array.isArray(data) ? data : data.versions || [];
                const ids = new Set(this.items.map(x => this.id(x))); this.selected.forEach(id => {if (!ids.has(id)) this.selected.delete(id);});
                this.render(); this.status.textContent = ''; const count = $(this.key + '-zaehler'); if (count) count.textContent = this.items.length;
            } catch (error) { if (seq === this.sequence) this.status.textContent = error.message + ' Über „Aktualisieren“ erneut versuchen.'; }
            finally { if (seq === this.sequence) this.table.removeAttribute('aria-busy'); }
        }
        render() {
            let rows = this.items.filter(x => this.columns.map(c => c[1](x)).join(' ').toLocaleLowerCase().includes(this.search.value.toLocaleLowerCase()) && (!this.filter || this.filter(x)));
            if (this.sort >= 0) rows.sort((a,b) => {const av=this.columns[this.sort][1](a), bv=this.columns[this.sort][1](b);return this.direction * (typeof av === 'number' && typeof bv === 'number' ? av-bv : String(av??'').localeCompare(String(bv??''),'de',{numeric:true}));});
            const pages = Math.max(1,Math.ceil(rows.length / Number(this.size.value))); this.page = Math.max(1,Math.min(this.page,pages)); this.visible = rows.slice((this.page-1)*this.size.value,this.page*this.size.value);
            this.header(); this.body.replaceChildren();
            this.visible.forEach(item => { const tr = el('tr');
                if (this.selectable) { const td=el('td'), check=el('input'); check.type='checkbox'; check.disabled=!!item.folder;check.checked=this.selected.has(this.id(item));check.setAttribute('aria-label',`${item.name || item.titel || 'Eintrag'} auswählen`);check.addEventListener('change',()=>{check.checked?this.selected.add(this.id(item)):this.selected.delete(this.id(item));this.updateSelection();});td.append(check);tr.append(td); }
                this.columns.forEach(([,get,format])=>{const td=el('td'); const v=format?format(item):get(item); if(v instanceof Node)td.append(v);else td.textContent=v??'–';tr.append(td);});
                const td=el('td',null,'cms-actions');this.actions(item).forEach(([label,fn,disabled])=>{const b=button(label,()=>run(this.host,()=>fn(item),'Aktion abgeschlossen.'));b.disabled=!!disabled;td.append(b);});tr.append(td);this.body.append(tr);
            });
            if (!this.visible.length) {const td=el('td','Keine Einträge gefunden.');td.colSpan=this.columns.length+2;const tr=el('tr',null,'leer-zeile');tr.append(td);this.body.append(tr);}
            this.prev.disabled=this.page===1;this.next.disabled=this.page===pages;this.info.textContent=`${rows.length} Einträge · Seite ${this.page} / ${pages}`;this.updateSelection();
        }
        updateSelection() {if(!this.selectable)return;this.bulk.disabled=!this.selected.size;this.bulk.textContent=`Auswahl löschen (${this.selected.size})`;const entries=this.visible.filter(x=>!x.folder);const count=entries.filter(x=>this.selected.has(this.id(x))).length;this.all.checked=!!entries.length&&count===entries.length;this.all.indeterminate=count>0&&count<entries.length;}
        async remove(ids) {
            const warning = this.key === 'file' ? 'Die Dateien werden endgültig vom Gerät gelöscht.' : this.key === 'steckbrief' ? 'Die Steckbriefe werden vom Screen entfernt. Gesicherte Stände bleiben im Änderungsverlauf verfügbar.' : 'Die ausgewählten Einträge werden entfernt. Gesicherte Stände bleiben im Änderungsverlauf verfügbar.';
            if(!ids.length || !confirm(`${ids.length} Eintrag/Einträge löschen? ${warning}`))return;
            await run(this.host,async()=>{if(this.key==='file')await api(this.url,'DELETE',{path:currentPath,names:ids});else {let done=0;try{for(const id of ids){await api(this.url+'/'+encodeURIComponent(id),'DELETE');this.selected.delete(id);done++;}}catch(e){throw new Error(`${done} gelöscht. ${e.message}`);}finally{await this.load();}}this.selected.clear();await this.load();},'Auswahl gelöscht.');
        }
    }
    async function move(list,item,delta) { const ids=list.items.map(x=>x.id),i=ids.indexOf(item.id);if(i+delta<0||i+delta>=ids.length)return;[ids[i],ids[i+delta]]=[ids[i+delta],ids[i]];await api(list.url+'/reihenfolge','PUT',{ids});await list.load(); }
    // Deletion manages its own busy scope; action dispatch must not nest that scope.
    const deletion = (list,item) => { setTimeout(()=>list.remove([list.id(item)]),0); };
    const orderActions = (list,item) => [['↑',()=>move(list,item,-1),list.items.indexOf(item)===0],['↓',()=>move(list,item,1),list.items.indexOf(item)===list.items.length-1]];
    const profileUrl = name => '/uploads/steckbriefe/'+String(name).split('/').map(encodeURIComponent).join('/');
    const profiles = new Listing('steckbrief','/api/steckbriefe',[
        ['Name',x=>x.name],['Datei',x=>x.originalName||x.dateiname],['Seiten',x=>(x.seiten||[]).length],['Status',x=>x.sichtbar===false?'Deaktiviert':'Aktiv'],['Upload',x=>x.uploadedAt||x.hochgeladenAm||'',x=>date(x.uploadedAt||x.hochgeladenAm)],['Größe',x=>x.bytes,x=>bytes(x.bytes)]
    ], x=>[...orderActions(profiles,x),['Umbenennen',()=>rename(profiles,x)], [x.sichtbar===false?'Aktivieren':'Deaktivieren',async()=>{await api(profiles.url+'/'+x.id,'PUT',{sichtbar:x.sichtbar===false});await profiles.load();}],['Vorschau',()=>preview(x.name,(x.seiten||[]).map(profileUrl))],['Ersetzen',()=>replaceProfile(x)],['Löschen',()=>deletion(profiles,x)]]);
    const messages = new Listing('mitteilung','/api/mitteilungen',[['Titel',x=>x.titel],['Datum',x=>x.datum||''],['Bis',x=>x.bis||'']],x=>[...orderActions(messages,x),['Bearbeiten',()=>editMessage(x)],['Löschen',()=>deletion(messages,x)]]);
    const birthdays = new Listing('geburtstag','/api/geburtstage',[['Name',x=>x.name],['Datum',x=>x.monat*100+x.tag,x=>`${String(x.tag).padStart(2,'0')}.${String(x.monat).padStart(2,'0')}.`]],x=>[['Löschen',()=>deletion(birthdays,x)]]);
    const files = new Listing('file','/api/files',[['Name',x=>x.name,x=>x.folder?button(x.name,()=>folder(currentPath?currentPath+'/'+x.name:x.name)):x.name],['Typ',x=>x.type||x.name.split('.').pop()],['Größe',x=>x.bytes??x.groesseKB*1024,x=>x.folder?'–':bytes(x.bytes??x.groesseKB*1024)]],x=>x.folder?[]:[['Umbenennen',()=>rename(files,x)],['Vorschau',()=>preview(x.name,[x.url||fileUrl(x.name)])],['URL kopieren',async()=>{const url=safeUrl(x.url||fileUrl(x.name));try{await navigator.clipboard.writeText(url);}catch{const box=openDialog('URL kopieren'),input=el('input');input.value=url;input.readOnly=true;box.append(input,el('p','Strg/Cmd+C zum Kopieren.'));input.select();}}],['Löschen',()=>deletion(files,x)]]);
    function fileUrl(name) {return '/uploads/'+[...currentPath.split('/').filter(Boolean),name].map(encodeURIComponent).join('/');}
    const typeFilter=el('select');typeFilter.setAttribute('aria-label','Dateityp filtern');['Alle Typen','Bilder','PDF','Andere','Ordner'].forEach(x=>typeFilter.add(new Option(x,x)));files.tools.append(typeFilter);
    files.filter=x=>typeFilter.value==='Alle Typen'||(typeFilter.value==='Ordner'?x.folder:typeFilter.value==='Bilder'? !x.folder&&/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(x.name):typeFilter.value==='PDF'?/\.pdf$/i.test(x.name):!x.folder&&!/\.(png|jpe?g|gif|webp|svg|bmp|avif|pdf)$/i.test(x.name));typeFilter.addEventListener('change',()=>{files.page=1;files.render();});
    function folder(path) {currentPath=path;files.selected.clear();files.page=1;const crumb=$('file-breadcrumb');crumb.replaceChildren(button('uploads',()=>folder('')));path.split('/').filter(Boolean).forEach((name,i,parts)=>crumb.append(' / ',button(name,()=>folder(parts.slice(0,i+1).join('/')))));files.load();}
    function upload(file,url,host,name) {
        return new Promise((resolve,reject)=>{const row=el('div',null,'cms-upload'),label=el('span',file.name),progress=el('progress'),status=el('span','Wartet …');progress.max=100;progress.value=0;progress.setAttribute('aria-label',`Upload ${file.name}`);row.append(label,progress,status);host.append(row);
            const xhr=new XMLHttpRequest(),data=new FormData();data.append('datei',file);if(name)data.append('name',name);xhr.open('POST',url);xhr.timeout=600000;
            xhr.upload.onprogress=e=>{if(e.lengthComputable){progress.value=Math.round(e.loaded/e.total*100);status.textContent=progress.value===100?'Wird auf dem Server verarbeitet …':`${progress.value} %`;}};
            xhr.onload=()=>{let data;try{data=JSON.parse(xhr.responseText);}catch{}if(xhr.status<200||xhr.status>=300||!data){status.textContent=data?.error||`Fehler (${xhr.status})`;reject(new Error(status.textContent));return;}progress.value=100;status.textContent=data.warnungen?.length?data.warnungen.join(' '):'Hochgeladen.';resolve(data);};
            xhr.onerror=()=>{status.textContent='Netzwerkfehler. Datei erneut auswählen, um es erneut zu versuchen.';reject(new Error(status.textContent));};xhr.ontimeout=()=>{status.textContent='Zeitüberschreitung. Vor erneutem Upload Liste aktualisieren.';reject(new Error(status.textContent));};xhr.send(data);
        });
    }
    function wireUpload(id,btn,list) {const input=$(id);input.multiple=true;$(btn).addEventListener('click',()=>input.click());const queue=el('div',null,'cms-upload-list');input.parentElement.append(queue);input.addEventListener('change',()=>{const batch=[...input.files],path=currentPath;input.value='';if(!batch.length)return;run(input.parentElement,async()=>{let failed=0;for(const file of batch){try{await upload(file,list===files?'/api/files?path='+encodeURIComponent(path):'/api/steckbriefe',queue,list===profiles?file.name.replace(/\.[^.]+$/,''):undefined);}catch{failed++;}}await list.load();if(failed)throw new Error(`${failed} von ${batch.length} Uploads fehlgeschlagen. Details stehen bei der Datei.`);},`${batch.length} Datei(en) hochgeladen.`);});}
    wireUpload('file-input','file-upload-btn',files);wireUpload('steckbrief-input','upload-btn',profiles);
    function replaceProfile(item) {const box=openDialog('Steckbrief ersetzen'),input=el('input');input.type='file';input.accept=$('steckbrief-input').accept;input.setAttribute('aria-label','Neue Datei');box.append(el('p',`Neue Datei für „${item.name}“. Name und Position bleiben erhalten.`),input);input.addEventListener('change',()=>{const file=input.files[0];if(!file||!confirm(`Datei von „${item.name}“ ersetzen?`))return;run(box,async()=>{await upload(file,'/api/steckbriefe/'+item.id+'/replace',box);await profiles.load();},'Datei ersetzt.');});}
    const mf=$('mitteilung-form');
    function resetMessage(){editId=null;mf.reset();$('mitteilung-submit').textContent='Hinzufügen';$('mitteilung-abbrechen').hidden=true;$('mitteilung-formular-titel').textContent='Neue Mitteilung';window.editorAuffrischen?.();markClean(mf);}
    function editMessage(x){if(snapshot(mf)!==baselines.get(mf)&&!confirm('Ungespeicherte Mitteilung verwerfen?'))return;editId=x.id;for(const key of ['titel','text','datum','bis'])$('mitteilung-'+key).value=x[key]||'';$('mitteilung-submit').textContent='Speichern';$('mitteilung-abbrechen').hidden=false;$('mitteilung-formular-titel').textContent='Mitteilung bearbeiten';window.editorAuffrischen?.();markClean(mf);$('mitteilung-titel').focus();}
    $('mitteilung-abbrechen').addEventListener('click',()=>{if(snapshot(mf)===baselines.get(mf)||confirm('Änderungen verwerfen?'))resetMessage();});
    function formSubmit(form,fn){markClean(form);form.addEventListener('submit',e=>{e.preventDefault();run(form,async()=>{await fn();markClean(form);});});}
    formSubmit(mf,async()=>{const data={};for(const key of ['titel','text','datum','bis'])data[key]=$('mitteilung-'+key).value||null;await api('/api/mitteilungen'+(editId===null?'':'/'+editId),editId===null?'POST':'PUT',data);resetMessage();await messages.load();});
    formSubmit($('geburtstag-form'),async()=>{const [,monat,tag]=$('geburtstag-datum').value.split('-').map(Number);await api('/api/geburtstage','POST',{name:$('geburtstag-name').value,monat,tag});$('geburtstag-form').reset();await birthdays.load();});
    async function loadSettings(){const f=$('einstellungen-form');await run(f,async()=>{const data=await api('/api/einstellungen');for(const key of ['effekt','anzeigedauer','effektdauer','uhrleiste','wetter','kalenderSlide','geburtstageSlide']){const n=$(key);if(n.type==='checkbox')n.checked=!!data[key];else n.value=data[key];}markClean(f);},'Einstellungen geladen.');}
    formSubmit($('einstellungen-form'),async()=>{const data={};for(const key of ['effekt','anzeigedauer','effektdauer','uhrleiste','wetter','kalenderSlide','geburtstageSlide']){const n=$(key);data[key]=n.type==='checkbox'?n.checked:n.value;}const saved=await api('/api/einstellungen','PUT',data);for(const key of ['anzeigedauer','effektdauer'])$(key).value=saved[key];});
    function hotspotFields(){$('hotspot-passwort').disabled=$('hotspot-sicherheit').value==='offen';}
    async function loadHotspot(){const f=$('hotspot-form');await run(f,async()=>{const data=await api('/api/hotspot');for(const key of ['aktiv','ssid','sicherheit','kanal','geraet']){const n=$('hotspot-'+key);if(n.type==='checkbox')n.checked=!!data[key];else n.value=data[key];}$('hotspot-passwort-hinweis').textContent=data.passwortGesetzt?'gesetzt – leer lassen um es zu behalten':'8 bis 63 Zeichen';$('hotspot-anwenden').hidden=!data.steuerbar;$('hotspot-befehl').textContent=data.steuerbar?'':`Zum Übernehmen auf dem Gerät ausführen: ${data.befehl||''}`;markClean(f);},'Hotspot geladen.');hotspotFields();}
    $('hotspot-sicherheit').addEventListener('change',hotspotFields);
    formSubmit($('hotspot-form'),async()=>{const data={};for(const key of ['aktiv','ssid','passwort','sicherheit','kanal','geraet']){const n=$('hotspot-'+key);data[key]=n.type==='checkbox'?n.checked:n.value;}await api('/api/hotspot','PUT',data);$('hotspot-passwort').value='';});
    $('hotspot-anwenden').addEventListener('click',()=>{if(confirm('Hotspot jetzt anwenden? Die Verbindung kann unterbrochen werden.'))run($('hotspot-form'),()=>api('/api/hotspot/anwenden','POST'));});
    const passwordCard=el('div',null,'karte');passwordCard.innerHTML='<h2>Dashboard-Passwort</h2><form id="password-form"><label for="current-password">Aktuelles Passwort</label><input id="current-password" type="password" autocomplete="current-password" required><label for="new-password">Neues Passwort</label><input id="new-password" type="password" autocomplete="new-password" required><label for="confirm-password">Neues Passwort bestätigen</label><input id="confirm-password" type="password" autocomplete="new-password" required><button type="submit">Passwort ändern</button></form>';$('einstellungen').append(passwordCard);
    formSubmit($('password-form'),async()=>{if($('new-password').value!==$('confirm-password').value)throw new Error('Die neuen Passwörter stimmen nicht überein.');await api('/api/password','PUT',{currentPassword:$('current-password').value,newPassword:$('new-password').value});$('password-form').reset();});
    const history=el('section',null,'tab-panel');history.id='versionen';history.hidden=true;history.innerHTML='<header class="seiten-kopf"><h1>Änderungsverlauf</h1><p>Gesicherte Inhaltsstände prüfen und wiederherstellen.</p></header><div class="karte"><table><thead></thead><tbody id="version-tbody"></tbody></table></div>';$('einstellungen').after(history);const historyLink=el('a','Änderungsverlauf');historyLink.href='#versionen';document.querySelector('.sidebar-fuss').before(historyLink);
    const versions=new Listing('version','/api/versions',[['Zeit',x=>x.createdAt||x.datum||'',x=>date(x.createdAt||x.datum)],['Änderung',x=>x.description||x.action||x.beschreibung||x.id]],x=>[['Prüfen',async()=>{const data=await api('/api/versions/'+encodeURIComponent(x.id));const box=openDialog('Gesicherter Stand');box.append(el('pre',JSON.stringify(data,null,2)));box.append(button('Diesen Stand wiederherstellen',()=>restore(x)));}],['Wiederherstellen',()=>restore(x)]],false);
    async function restore(x){if(dirty()){notice('Vor dem Wiederherstellen bitte offene Formulare speichern oder Änderungen verwerfen.');return;}if(!confirm('Vollständigen Inhaltsstand wiederherstellen? ALLE Steckbriefe, Mitteilungen, Geburtstage und Anzeige-Einstellungen werden durch diesen Stand ersetzt. Passwörter und Hotspot bleiben unverändert. Endgültig gelöschte Mediendateien kommen nicht zurück.'))return;await api('/api/versions/'+encodeURIComponent(x.id)+'/restore','POST');if(dialog.open)dialog.close();await Promise.all([profiles.load(),messages.load(),birthdays.load(),versions.load(),files.load()]);await loadSettings();resetMessage();}
    async function versionInfo(){try{const f=await api('/api/fassung');$('fassung').textContent=f.git?`${f.commit} · ${f.zweig} · ${f.nachricht} · Version ${f.version}${f.geaendert?' · lokal geändert':''}`:`Version ${f.version}`;}catch(e){$('fassung').textContent=e.message;}}
    function screen(){const frame=$('vorschau-frame');document.querySelector('.vorschau-rahmen').style.setProperty('--vorschau-faktor',document.querySelector('.vorschau-rahmen').clientWidth/1920);if(!frame.getAttribute('src'))frame.src='/display/index.html';}
    $('vorschau-neu').addEventListener('click',()=>{$('vorschau-frame').removeAttribute('src');screen();});window.addEventListener('resize',()=>{if(active==='vorschau')screen();});
    function navigate(target,push=false){if(!document.querySelector('.tab-panel#'+CSS.escape(target)))target='steckbriefe';if(active&&target!==active&&!leave()){historyReplace(active);return;}active=target;document.querySelectorAll('.tab-panel').forEach(n=>n.hidden=n.id!==target);document.querySelectorAll('.sidebar a[href^="#"]').forEach(n=>{n.classList.toggle('active',n.hash==='#'+target);if(n.hash==='#'+target){n.setAttribute('aria-current','page');$('toolbar-title').textContent=n.textContent;document.title=n.textContent+' – Infoscreen';}else n.removeAttribute('aria-current');});if(push)window.history.pushState(null,'','#'+target);try{localStorage.setItem('cms-section',target);}catch{}if(target==='vorschau')screen();else $('vorschau-frame').removeAttribute('src');if(target==='versionen')versions.load();}
    function historyReplace(target){window.history.replaceState(null,'','#'+target);}
    document.querySelectorAll('.sidebar a[href^="#"]').forEach(n=>n.addEventListener('click',e=>{e.preventDefault();navigate(n.hash.slice(1),n.hash!==location.hash);}));
    window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)));
    window.addEventListener('beforeunload',e=>{if(dirty()||pending){e.preventDefault();e.returnValue='';}});
    document.querySelector('.logout-form').addEventListener('submit',e=>{if((dirty()||pending)&&!confirm('Ungespeicherte Änderungen oder laufende Vorgänge. Trotzdem abmelden?'))e.preventDefault();});
    let initial=location.hash.slice(1);if(!initial)try{initial=localStorage.getItem('cms-section');}catch{}navigate(initial||'steckbriefe');historyReplace(active);
    profiles.load();messages.load();birthdays.load();folder('');loadSettings();loadHotspot();versionInfo();
})();
