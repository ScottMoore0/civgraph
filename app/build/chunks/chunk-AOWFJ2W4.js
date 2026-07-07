import{a as L,b as U,c as Ct,d as Rn,f as to,g as In,h as Lt,i as et,j as k,k as Fi,l as On,m as Nn,n as Un,o as Dn,p as kn,q as Bn,r as zi,s as ji,t as Gi}from"./chunk-UYEREWGA.js";import{$ as te,G as Cn,H as Pt,L as Ln,R as F,S as Tt,T as At,V as pe,X as ee,Y as z,_ as H,aa as O}from"./chunk-URQP42HF.js";import{c as An,e as Qe}from"./chunk-5HW5CZMC.js";import{e as m}from"./chunk-KGWEWERB.js";var Rl=new An({id:"deck"}),M=Rl;var R;(function(r){r[r.Start=1]="Start",r[r.Move=2]="Move",r[r.End=4]="End",r[r.Cancel=8]="Cancel"})(R||(R={}));var D;(function(r){r[r.None=0]="None",r[r.Left=1]="Left",r[r.Right=2]="Right",r[r.Up=4]="Up",r[r.Down=8]="Down",r[r.Horizontal=3]="Horizontal",r[r.Vertical=12]="Vertical",r[r.All=15]="All"})(D||(D={}));var w;(function(r){r[r.Possible=1]="Possible",r[r.Began=2]="Began",r[r.Changed=4]="Changed",r[r.Ended=8]="Ended",r[r.Recognized=8]="Recognized",r[r.Cancelled=16]="Cancelled",r[r.Failed=32]="Failed"})(w||(w={}));var Vn="compute",io="auto",tt="manipulation",Ne="none",Rt="pan-x",It="pan-y";function ro(r){if(r.includes(Ne))return Ne;let e=r.includes(Rt),t=r.includes(It);return e&&t?Ne:e||t?e?Rt:It:r.includes(tt)?tt:io}var Ot=class{constructor(e,t){this.actions="",this.manager=e,this.set(t)}set(e){e===Vn&&(e=this.compute()),this.manager.element&&(this.manager.element.style.touchAction=e,this.actions=e)}update(){this.set(this.manager.options.touchAction)}compute(){let e=[];for(let t of this.manager.recognizers)t.options.enable&&(e=e.concat(t.getTouchAction()));return ro(e.join(" "))}};function it(r){return r.trim().split(/\s+/g)}function Hi(r,e,t){if(r)for(let i of it(e))r.addEventListener(i,t,!1)}function Wi(r,e,t){if(r)for(let i of it(e))r.removeEventListener(i,t,!1)}function oo(r){return(r.ownerDocument||r).defaultView}function no(r,e){let t=r;for(;t;){if(t===e)return!0;t=t.parentNode}return!1}function $i(r){let e=r.length;if(e===1)return{x:Math.round(r[0].clientX),y:Math.round(r[0].clientY)};let t=0,i=0,o=0;for(;o<e;)t+=r[o].clientX,i+=r[o].clientY,o++;return{x:Math.round(t/e),y:Math.round(i/e)}}function so(r){let e=[],t=0;for(;t<r.pointers.length;)e[t]={clientX:Math.round(r.pointers[t].clientX),clientY:Math.round(r.pointers[t].clientY)},t++;return{timeStamp:Date.now(),pointers:e,center:$i(e),deltaX:r.deltaX,deltaY:r.deltaY}}function Nt(r,e){let t=e.x-r.x,i=e.y-r.y;return Math.sqrt(t*t+i*i)}function ao(r,e){let t=e.clientX-r.clientX,i=e.clientY-r.clientY;return Math.sqrt(t*t+i*i)}function Fn(r,e){let t=e.x-r.x,i=e.y-r.y;return Math.atan2(i,t)*180/Math.PI}function lo(r,e){let t=e.clientX-r.clientX,i=e.clientY-r.clientY;return Math.atan2(i,t)*180/Math.PI}function Yi(r,e){return r===e?D.None:Math.abs(r)>=Math.abs(e)?r<0?D.Left:D.Right:e<0?D.Up:D.Down}function zn(r,e){let t=e.center,i=r.offsetDelta,o=r.prevDelta,n=r.prevInput;return(e.eventType===R.Start||n?.eventType===R.End)&&(o=r.prevDelta={x:n?.deltaX||0,y:n?.deltaY||0},i=r.offsetDelta={x:t.x,y:t.y}),{deltaX:o.x+(t.x-i.x),deltaY:o.y+(t.y-i.y)}}function qi(r,e,t){return{x:e/r||0,y:t/r||0}}function jn(r,e){return ao(e[0],e[1])/ao(r[0],r[1])}function Gn(r,e){return lo(e[1],e[0])-lo(r[1],r[0])}function Hn(r,e){let t=r.lastInterval||e,i=e.timeStamp-t.timeStamp,o,n,s,a;if(e.eventType!==R.Cancel&&(i>25||t.velocity===void 0)){let l=e.deltaX-t.deltaX,c=e.deltaY-t.deltaY,f=qi(i,l,c);n=f.x,s=f.y,o=Math.abs(f.x)>Math.abs(f.y)?f.x:f.y,a=Yi(l,c),r.lastInterval=e}else o=t.velocity,n=t.velocityX,s=t.velocityY,a=t.direction;e.velocity=o,e.velocityX=n,e.velocityY=s,e.direction=a}function Wn(r,e){let{session:t}=r,{pointers:i}=e,{length:o}=i;t.firstInput||(t.firstInput=so(e)),o>1&&!t.firstMultiple?t.firstMultiple=so(e):o===1&&(t.firstMultiple=!1);let{firstInput:n,firstMultiple:s}=t,a=s?s.center:n.center,l=e.center=$i(i);e.timeStamp=Date.now(),e.deltaTime=e.timeStamp-n.timeStamp,e.angle=Fn(a,l),e.distance=Nt(a,l);let{deltaX:c,deltaY:f}=zn(t,e);e.deltaX=c,e.deltaY=f,e.offsetDirection=Yi(e.deltaX,e.deltaY);let u=qi(e.deltaTime,e.deltaX,e.deltaY);e.overallVelocityX=u.x,e.overallVelocityY=u.y,e.overallVelocity=Math.abs(u.x)>Math.abs(u.y)?u.x:u.y,e.scale=s?jn(s.pointers,i):1,e.rotation=s?Gn(s.pointers,i):0,e.maxPointers=t.prevInput?e.pointers.length>t.prevInput.maxPointers?e.pointers.length:t.prevInput.maxPointers:e.pointers.length;let h=r.element;return no(e.srcEvent.target,h)&&(h=e.srcEvent.target),e.target=h,Hn(t,e),e}function $n(r,e,t){let i=t.pointers.length,o=t.changedPointers.length,n=e&R.Start&&i-o===0,s=e&(R.End|R.Cancel)&&i-o===0;t.isFirst=!!n,t.isFinal=!!s,n&&(r.session={}),t.eventType=e;let a=Wn(r,t);r.emit("hammer.input",a),r.recognize(a),r.session.prevInput=a}var Ut=class{constructor(e){this.evEl="",this.evWin="",this.evTarget="",this.domHandler=t=>{this.manager.options.enable&&this.handler(t)},this.manager=e,this.element=e.element,this.target=e.options.inputTarget||e.element}callback(e,t){$n(this.manager,e,t)}init(){Hi(this.element,this.evEl,this.domHandler),Hi(this.target,this.evTarget,this.domHandler),Hi(oo(this.element),this.evWin,this.domHandler)}destroy(){Wi(this.element,this.evEl,this.domHandler),Wi(this.target,this.evTarget,this.domHandler),Wi(oo(this.element),this.evWin,this.domHandler)}};var Ol={pointerdown:R.Start,pointermove:R.Move,pointerup:R.End,pointercancel:R.Cancel,pointerout:R.Cancel},Nl="pointerdown",Ul="pointermove pointerup pointercancel",Dt=class extends Ut{constructor(e){super(e),this.evEl=Nl,this.evWin=Ul,this.store=this.manager.session.pointerEvents=[],this.init()}handler(e){let{store:t}=this,i=!1,o=Ol[e.type],n=e.pointerType,s=n==="touch",a=t.findIndex(l=>l.pointerId===e.pointerId);o&R.Start&&(e.buttons||s)?a<0&&(t.push(e),a=t.length-1):o&(R.End|R.Cancel)&&(i=!0),!(a<0)&&(t[a]=e,this.callback(o,{pointers:t,changedPointers:[e],eventType:o,pointerType:n,srcEvent:e}),i&&t.splice(a,1))}};var Dl=["","webkit","Moz","MS","ms","o"];function Yn(r,e){let t=e[0].toUpperCase()+e.slice(1);for(let i of Dl){let o=i?i+t:e;if(o in r)return o}}var kl=1,qn=2,Xn={touchAction:"compute",enable:!0,inputTarget:null,cssProps:{userSelect:"none",userDrag:"none",touchCallout:"none",tapHighlightColor:"rgba(0,0,0,0)"}},kt=class{constructor(e,t){this.options={...Xn,...t,cssProps:{...Xn.cssProps,...t.cssProps},inputTarget:t.inputTarget||e},this.handlers={},this.session={},this.recognizers=[],this.oldCssProps={},this.element=e,this.input=new Dt(this),this.touchAction=new Ot(this,this.options.touchAction),this.toggleCssProps(!0)}set(e){return Object.assign(this.options,e),e.touchAction&&this.touchAction.update(),e.inputTarget&&(this.input.destroy(),this.input.target=e.inputTarget,this.input.init()),this}stop(e){this.session.stopped=e?qn:kl}recognize(e){let{session:t}=this;if(t.stopped)return;this.session.prevented&&e.srcEvent.preventDefault();let i,{recognizers:o}=this,{curRecognizer:n}=t;(!n||n&&n.state&w.Recognized)&&(n=t.curRecognizer=null);let s=0;for(;s<o.length;)i=o[s],t.stopped!==qn&&(!n||i===n||i.canRecognizeWith(n))?i.recognize(e):i.reset(),!n&&i.state&(w.Began|w.Changed|w.Ended)&&(n=t.curRecognizer=i),s++}get(e){let{recognizers:t}=this;for(let i=0;i<t.length;i++)if(t[i].options.event===e)return t[i];return null}add(e){if(Array.isArray(e)){for(let i of e)this.add(i);return this}let t=this.get(e.options.event);return t&&this.remove(t),this.recognizers.push(e),e.manager=this,this.touchAction.update(),e}remove(e){if(Array.isArray(e)){for(let i of e)this.remove(i);return this}let t=typeof e=="string"?this.get(e):e;if(t){let{recognizers:i}=this,o=i.indexOf(t);o!==-1&&(i.splice(o,1),this.touchAction.update())}return this}on(e,t){if(!e||!t)return;let{handlers:i}=this;for(let o of it(e))i[o]=i[o]||[],i[o].push(t)}off(e,t){if(!e)return;let{handlers:i}=this;for(let o of it(e))t?i[o]&&i[o].splice(i[o].indexOf(t),1):delete i[o]}emit(e,t){let i=this.handlers[e]&&this.handlers[e].slice();if(!i||!i.length)return;let o=t;o.type=e,o.preventDefault=function(){t.srcEvent.preventDefault()};let n=0;for(;n<i.length;)i[n](o),n++}destroy(){this.toggleCssProps(!1),this.handlers={},this.session={},this.input.destroy(),this.element=null}toggleCssProps(e){let{element:t}=this;if(t){for(let[i,o]of Object.entries(this.options.cssProps)){let n=Yn(t.style,i);e?(this.oldCssProps[n]=t.style[n],t.style[n]=o):t.style[n]=this.oldCssProps[n]||""}e||(this.oldCssProps={})}}};var Bl=1;function Zn(){return Bl++}function co(r){return r&w.Cancelled?"cancel":r&w.Ended?"end":r&w.Changed?"move":r&w.Began?"start":""}var le=class{constructor(e){this.options=e,this.id=Zn(),this.state=w.Possible,this.simultaneous={},this.requireFail=[]}set(e){return Object.assign(this.options,e),this.manager.touchAction.update(),this}recognizeWith(e){if(Array.isArray(e)){for(let o of e)this.recognizeWith(o);return this}let t;if(typeof e=="string"){if(t=this.manager.get(e),!t)throw new Error(`Cannot find recognizer ${e}`)}else t=e;let{simultaneous:i}=this;return i[t.id]||(i[t.id]=t,t.recognizeWith(this)),this}dropRecognizeWith(e){if(Array.isArray(e)){for(let i of e)this.dropRecognizeWith(i);return this}let t;return typeof e=="string"?t=this.manager.get(e):t=e,t&&delete this.simultaneous[t.id],this}requireFailure(e){if(Array.isArray(e)){for(let o of e)this.requireFailure(o);return this}let t;if(typeof e=="string"){if(t=this.manager.get(e),!t)throw new Error(`Cannot find recognizer ${e}`)}else t=e;let{requireFail:i}=this;return i.indexOf(t)===-1&&(i.push(t),t.requireFailure(this)),this}dropRequireFailure(e){if(Array.isArray(e)){for(let i of e)this.dropRequireFailure(i);return this}let t;if(typeof e=="string"?t=this.manager.get(e):t=e,t){let i=this.requireFail.indexOf(t);i>-1&&this.requireFail.splice(i,1)}return this}hasRequireFailures(){return!!this.requireFail.find(e=>e.options.enable)}canRecognizeWith(e){return!!this.simultaneous[e.id]}emit(e){if(!e)return;let{state:t}=this;t<w.Ended&&this.manager.emit(this.options.event+co(t),e),this.manager.emit(this.options.event,e),e.additionalEvent&&this.manager.emit(e.additionalEvent,e),t>=w.Ended&&this.manager.emit(this.options.event+co(t),e)}tryEmit(e){this.canEmit()?this.emit(e):this.state=w.Failed}canEmit(){let e=0;for(;e<this.requireFail.length;){if(!(this.requireFail[e].state&(w.Failed|w.Possible)))return!1;e++}return!0}recognize(e){let t={...e};if(!this.options.enable){this.reset(),this.state=w.Failed;return}this.state&(w.Recognized|w.Cancelled|w.Failed)&&(this.state=w.Possible),this.state=this.process(t),this.state&(w.Began|w.Changed|w.Ended|w.Cancelled)&&this.tryEmit(t)}getEventNames(){return[this.options.event]}reset(){}};var de=class extends le{attrTest(e){let t=this.options.pointers;return t===0||e.pointers.length===t}process(e){let{state:t}=this,{eventType:i}=e,o=t&(w.Began|w.Changed),n=this.attrTest(e);return o&&(i&R.Cancel||!n)?t|w.Cancelled:o||n?i&R.End?t|w.Ended:t&w.Began?t|w.Changed:w.Began:w.Failed}};var Ue=class extends le{constructor(e={}){super({enable:!0,event:"tap",pointers:1,taps:1,interval:300,time:250,threshold:9,posThreshold:10,...e}),this.pTime=null,this.pCenter=null,this._timer=null,this._input=null,this.count=0}getTouchAction(){return[tt]}process(e){let{options:t}=this,i=e.pointers.length===t.pointers,o=e.distance<t.threshold,n=e.deltaTime<t.time;if(this.reset(),e.eventType&R.Start&&this.count===0)return this.failTimeout();if(o&&n&&i){if(e.eventType!==R.End)return this.failTimeout();let s=this.pTime?e.timeStamp-this.pTime<t.interval:!0,a=!this.pCenter||Nt(this.pCenter,e.center)<t.posThreshold;if(this.pTime=e.timeStamp,this.pCenter=e.center,!a||!s?this.count=1:this.count+=1,this._input=e,this.count%t.taps===0)return this.hasRequireFailures()?(this._timer=setTimeout(()=>{this.state=w.Recognized,this.tryEmit(this._input)},t.interval),w.Began):w.Recognized}return w.Failed}failTimeout(){return this._timer=setTimeout(()=>{this.state=w.Failed},this.options.interval),w.Failed}reset(){clearTimeout(this._timer)}emit(e){this.state===w.Recognized&&(e.tapCount=this.count,this.manager.emit(this.options.event,e))}};var Vl=["","start","move","end","cancel","up","down","left","right"],Ee=class extends de{constructor(e={}){super({enable:!0,pointers:1,event:"pan",threshold:10,direction:D.All,...e}),this.pX=null,this.pY=null}getTouchAction(){let{options:{direction:e}}=this,t=[];return e&D.Horizontal&&t.push(It),e&D.Vertical&&t.push(Rt),t}getEventNames(){return Vl.map(e=>this.options.event+e)}directionTest(e){let{options:t}=this,i=!0,{distance:o}=e,{direction:n}=e,s=e.deltaX,a=e.deltaY;return n&t.direction||(t.direction&D.Horizontal?(n=s===0?D.None:s<0?D.Left:D.Right,i=s!==this.pX,o=Math.abs(e.deltaX)):(n=a===0?D.None:a<0?D.Up:D.Down,i=a!==this.pY,o=Math.abs(e.deltaY))),e.direction=n,i&&o>t.threshold&&!!(n&t.direction)}attrTest(e){return super.attrTest(e)&&(!!(this.state&w.Began)||!(this.state&w.Began)&&this.directionTest(e))}emit(e){this.pX=e.deltaX,this.pY=e.deltaY;let t=D[e.direction].toLowerCase();t&&(e.additionalEvent=this.options.event+t),super.emit(e)}};var Fl=["","start","move","end","cancel","in","out"],rt=class extends de{constructor(e={}){super({enable:!0,event:"pinch",threshold:0,pointers:2,...e})}getTouchAction(){return[Ne]}getEventNames(){return Fl.map(e=>this.options.event+e)}attrTest(e){return super.attrTest(e)&&(Math.abs(e.scale-1)>this.options.threshold||!!(this.state&w.Began))}emit(e){if(e.scale!==1){let t=e.scale<1?"in":"out";e.additionalEvent=this.options.event+t}super.emit(e)}};var ce=class{constructor(e,t,i){this.element=e,this.callback=t,this.options=i}};var Kn=typeof navigator<"u"&&navigator.userAgent?navigator.userAgent.toLowerCase():"",Qm=typeof window<"u"?window:global;var Wl=Kn.indexOf("firefox")!==-1,Jn=4.000244140625,$l=40,Yl=.25,Xi=class extends ce{constructor(e,t,i){super(e,t,{enable:!0,...i}),this.handleEvent=o=>{if(!this.options.enable)return;let n=o.deltaY;globalThis.WheelEvent&&(Wl&&o.deltaMode===globalThis.WheelEvent.DOM_DELTA_PIXEL&&(n/=globalThis.devicePixelRatio),o.deltaMode===globalThis.WheelEvent.DOM_DELTA_LINE&&(n*=$l)),n!==0&&n%Jn===0&&(n=Math.floor(n/Jn)),o.shiftKey&&n&&(n=n*Yl),this.callback({type:"wheel",center:{x:o.clientX,y:o.clientY},delta:-n,srcEvent:o,pointerType:"mouse",target:o.target})},e.addEventListener("wheel",this.handleEvent,{passive:!1})}destroy(){this.element.removeEventListener("wheel",this.handleEvent)}enableEventType(e,t){e==="wheel"&&(this.options.enable=t)}};var Qn=["mousedown","mousemove","mouseup","mouseover","mouseout","mouseleave"],Zi=class extends ce{constructor(e,t,i){super(e,t,{enable:!0,...i}),this.handleEvent=n=>{this.handleOverEvent(n),this.handleOutEvent(n),this.handleEnterEvent(n),this.handleLeaveEvent(n),this.handleMoveEvent(n)},this.pressed=!1;let{enable:o}=this.options;this.enableMoveEvent=o,this.enableLeaveEvent=o,this.enableEnterEvent=o,this.enableOutEvent=o,this.enableOverEvent=o,Qn.forEach(n=>e.addEventListener(n,this.handleEvent))}destroy(){Qn.forEach(e=>this.element.removeEventListener(e,this.handleEvent))}enableEventType(e,t){switch(e){case"pointermove":this.enableMoveEvent=t;break;case"pointerover":this.enableOverEvent=t;break;case"pointerout":this.enableOutEvent=t;break;case"pointerenter":this.enableEnterEvent=t;break;case"pointerleave":this.enableLeaveEvent=t;break;default:}}handleOverEvent(e){this.enableOverEvent&&e.type==="mouseover"&&this._emit("pointerover",e)}handleOutEvent(e){this.enableOutEvent&&e.type==="mouseout"&&this._emit("pointerout",e)}handleEnterEvent(e){this.enableEnterEvent&&e.type==="mouseenter"&&this._emit("pointerenter",e)}handleLeaveEvent(e){this.enableLeaveEvent&&e.type==="mouseleave"&&this._emit("pointerleave",e)}handleMoveEvent(e){if(this.enableMoveEvent)switch(e.type){case"mousedown":e.button>=0&&(this.pressed=!0);break;case"mousemove":e.buttons===0&&(this.pressed=!1),this.pressed||this._emit("pointermove",e);break;case"mouseup":this.pressed=!1;break;default:}}_emit(e,t){this.callback({type:e,center:{x:t.clientX,y:t.clientY},srcEvent:t,pointerType:"mouse",target:t.target})}};var es=["keydown","keyup"],Ki=class extends ce{constructor(e,t,i){super(e,t,{enable:!0,tabIndex:0,...i}),this.handleEvent=o=>{let n=o.target||o.srcElement;n.tagName==="INPUT"&&n.type==="text"||n.tagName==="TEXTAREA"||(this.enableDownEvent&&o.type==="keydown"&&this.callback({type:"keydown",srcEvent:o,key:o.key,target:o.target}),this.enableUpEvent&&o.type==="keyup"&&this.callback({type:"keyup",srcEvent:o,key:o.key,target:o.target}))},this.enableDownEvent=this.options.enable,this.enableUpEvent=this.options.enable,e.tabIndex=this.options.tabIndex,e.style.outline="none",es.forEach(o=>e.addEventListener(o,this.handleEvent))}destroy(){es.forEach(e=>this.element.removeEventListener(e,this.handleEvent))}enableEventType(e,t){e==="keydown"&&(this.enableDownEvent=t),e==="keyup"&&(this.enableUpEvent=t)}};var Ji=class extends ce{constructor(e,t,i){super(e,t,i),this.handleEvent=o=>{this.options.enable&&this.callback({type:"contextmenu",center:{x:o.clientX,y:o.clientY},srcEvent:o,pointerType:"mouse",target:o.target})},e.addEventListener("contextmenu",this.handleEvent)}destroy(){this.element.removeEventListener("contextmenu",this.handleEvent)}enableEventType(e,t){e==="contextmenu"&&(this.options.enable=t)}};var ql={pointerdown:1,pointermove:2,pointerup:4,mousedown:1,mousemove:2,mouseup:4},Xl=0,Zl=1,Kl=2,Jl=1,Ql=2,ec=4;function ts(r){let e=ql[r.srcEvent.type];if(!e)return null;let{buttons:t,button:i}=r.srcEvent,o=!1,n=!1,s=!1;return e===2?(o=!!(t&Jl),n=!!(t&ec),s=!!(t&Ql)):(o=i===Xl,n=i===Zl,s=i===Kl),{leftButton:o,middleButton:n,rightButton:s}}function is(r,e){let t=r.center;if(!t)return null;let i=e.getBoundingClientRect(),o=i.width/e.offsetWidth||1,n=i.height/e.offsetHeight||1,s={x:(t.x-i.left-e.clientLeft)/o,y:(t.y-i.top-e.clientTop)/n};return{center:t,offsetCenter:s}}var tc={srcElement:"root",priority:0},Qi=class{constructor(e,t){this.handleEvent=i=>{if(this.isEmpty())return;let o=this._normalizeEvent(i),n=i.srcEvent.target;for(;n&&n!==o.rootElement;){if(this._emit(o,n),o.handled)return;n=n.parentNode}this._emit(o,"root")},this.eventManager=e,this.recognizerName=t,this.handlers=[],this.handlersByElement=new Map,this._active=!1}isEmpty(){return!this._active}add(e,t,i,o=!1,n=!1){let{handlers:s,handlersByElement:a}=this,l={...tc,...i},c=a.get(l.srcElement);c||(c=[],a.set(l.srcElement,c));let f={type:e,handler:t,srcElement:l.srcElement,priority:l.priority};o&&(f.once=!0),n&&(f.passive=!0),s.push(f),this._active=this._active||!f.passive;let u=c.length-1;for(;u>=0&&!(c[u].priority>=f.priority);)u--;c.splice(u+1,0,f)}remove(e,t){let{handlers:i,handlersByElement:o}=this;for(let n=i.length-1;n>=0;n--){let s=i[n];if(s.type===e&&s.handler===t){i.splice(n,1);let a=o.get(s.srcElement);a.splice(a.indexOf(s),1),a.length===0&&o.delete(s.srcElement)}}this._active=i.some(n=>!n.passive)}_emit(e,t){let i=this.handlersByElement.get(t);if(i){let o=!1,n=()=>{e.handled=!0},s=()=>{e.handled=!0,o=!0},a=[];for(let l=0;l<i.length;l++){let{type:c,handler:f,once:u}=i[l];if(f({...e,type:c,stopPropagation:n,stopImmediatePropagation:s}),u&&a.push(i[l]),o)break}for(let l=0;l<a.length;l++){let{type:c,handler:f}=a[l];this.remove(c,f)}}}_normalizeEvent(e){let t=this.eventManager.getElement();return{...e,...ts(e),...is(e,t),preventDefault:()=>{e.srcEvent.preventDefault()},stopImmediatePropagation:null,stopPropagation:null,handled:!1,rootElement:t}}};function ic(r){if("recognizer"in r)return r;let e,t=Array.isArray(r)?[...r]:[r];if(typeof t[0]=="function"){let i=t.shift(),o=t.shift()||{};e=new i(o)}else e=t.shift();return{recognizer:e,recognizeWith:typeof t[0]=="string"?[t[0]]:t[0],requireFailure:typeof t[1]=="string"?[t[1]]:t[1]}}var Bt=class{constructor(e=null,t={}){if(this._onBasicInput=i=>{this.manager.emit(i.srcEvent.type,i)},this._onOtherEvent=i=>{this.manager.emit(i.type,i)},this.options={recognizers:[],events:{},touchAction:"compute",tabIndex:0,cssProps:{},...t},this.events=new Map,this.element=e,!!e){this.manager=new kt(e,this.options);for(let i of this.options.recognizers){let{recognizer:o,recognizeWith:n,requireFailure:s}=ic(i);this.manager.add(o),n&&o.recognizeWith(n),s&&o.requireFailure(s)}this.manager.on("hammer.input",this._onBasicInput),this.wheelInput=new Xi(e,this._onOtherEvent,{enable:!1}),this.moveInput=new Zi(e,this._onOtherEvent,{enable:!1}),this.keyInput=new Ki(e,this._onOtherEvent,{enable:!1,tabIndex:t.tabIndex}),this.contextmenuInput=new Ji(e,this._onOtherEvent,{enable:!1}),this.on(this.options.events)}}getElement(){return this.element}destroy(){this.element&&(this.wheelInput.destroy(),this.moveInput.destroy(),this.keyInput.destroy(),this.contextmenuInput.destroy(),this.manager.destroy())}on(e,t,i){this._addEventHandler(e,t,i,!1)}once(e,t,i){this._addEventHandler(e,t,i,!0)}watch(e,t,i){this._addEventHandler(e,t,i,!1,!0)}off(e,t){this._removeEventHandler(e,t)}_toggleRecognizer(e,t){let{manager:i}=this;if(!i)return;let o=i.get(e);o&&(o.set({enable:t}),i.touchAction.update()),this.wheelInput?.enableEventType(e,t),this.moveInput?.enableEventType(e,t),this.keyInput?.enableEventType(e,t),this.contextmenuInput?.enableEventType(e,t)}_addEventHandler(e,t,i,o,n){if(typeof e!="string"){i=t;for(let[c,f]of Object.entries(e))this._addEventHandler(c,f,i,o,n);return}let{manager:s,events:a}=this;if(!s)return;let l=a.get(e);if(!l){let c=this._getRecognizerName(e)||e;l=new Qi(this,c),a.set(e,l),s&&s.on(e,l.handleEvent)}l.add(e,t,i,o,n),l.isEmpty()||this._toggleRecognizer(l.recognizerName,!0)}_removeEventHandler(e,t){if(typeof e!="string"){for(let[n,s]of Object.entries(e))this._removeEventHandler(n,s);return}let{events:i}=this,o=i.get(e);if(o&&(o.remove(e,t),o.isEmpty())){let{recognizerName:n}=o,s=!1;for(let a of i.values())if(a.recognizerName===n&&!a.isEmpty()){s=!0;break}s||this._toggleRecognizer(n,!1)}}_getRecognizerName(e){return this.manager.recognizers.find(t=>t.getEventNames().includes(e))?.options.event}};var fo={DEFAULT:"default",LNGLAT:"lnglat",METER_OFFSETS:"meter-offsets",LNGLAT_OFFSETS:"lnglat-offsets",CARTESIAN:"cartesian"};Object.defineProperty(fo,"IDENTITY",{get:()=>(M.deprecated("COORDINATE_SYSTEM.IDENTITY","COORDINATE_SYSTEM.CARTESIAN")(),fo.CARTESIAN)});var j={WEB_MERCATOR:1,GLOBE:2,WEB_MERCATOR_AUTO_OFFSET:4,IDENTITY:0},De={common:0,meters:1,pixels:2},ot={click:"onClick",dblclick:"onClick",panstart:"onDragStart",panmove:"onDrag",panend:"onDragEnd"},uo={multipan:[Ee,{threshold:10,direction:D.Vertical,pointers:2}],pinch:[rt,{},null,["multipan"]],pan:[Ee,{threshold:1},["pinch"],["multipan"]],dblclick:[Ue,{event:"dblclick",taps:2}],click:[Ue,{event:"click"},null,["dblclick"]]};var ho={};function X(r="id"){ho[r]=ho[r]||1;let e=ho[r]++;return`${r}-${e}`}var po=class{constructor(e){m(this,"id");m(this,"topology");m(this,"vertexCount");m(this,"indices");m(this,"attributes");m(this,"userData",{});let{attributes:t={},indices:i=null,vertexCount:o=null}=e;this.id=e.id||X("geometry"),this.topology=e.topology,i&&(this.indices=ArrayBuffer.isView(i)?{value:i,size:1}:i),this.attributes={};for(let[n,s]of Object.entries(t)){let a=ArrayBuffer.isView(s)?{value:s}:s;if(!ArrayBuffer.isView(a.value))throw new Error(`${this._print(n)}: must be typed array or object with value as typed array`);if((n==="POSITION"||n==="positions")&&!a.size&&(a.size=3),n==="indices"){if(this.indices)throw new Error("Multiple indices detected");this.indices=a}else this.attributes[n]=a}this.indices&&this.indices.isIndexed!==void 0&&(this.indices=Object.assign({},this.indices),delete this.indices.isIndexed),this.vertexCount=o||this._calculateVertexCount(this.attributes,this.indices)}getVertexCount(){return this.vertexCount}getAttributes(){return this.indices?{indices:this.indices,...this.attributes}:this.attributes}_print(e){return`Geometry ${this.id} attribute ${e}`}_setAttributes(e,t){return this}_calculateVertexCount(e,t){if(t)return t.value.length;let i=1/0;for(let o of Object.values(e)){let{value:n,size:s,constant:a}=o;!a&&n&&s!==void 0&&s>=1&&(i=Math.min(i,n.length/s))}return i}};var rc=1,oc=1,ke=class{constructor(){m(this,"time",0);m(this,"channels",new Map);m(this,"animations",new Map);m(this,"playing",!1);m(this,"lastEngineTime",-1)}addChannel(e){let{delay:t=0,duration:i=Number.POSITIVE_INFINITY,rate:o=1,repeat:n=1}=e,s=rc++,a={time:0,delay:t,duration:i,rate:o,repeat:n};return this._setChannelTime(a,this.time),this.channels.set(s,a),s}removeChannel(e){this.channels.delete(e);for(let[t,i]of this.animations)i.channel===e&&this.detachAnimation(t)}isFinished(e){let t=this.channels.get(e);return t===void 0?!1:this.time>=t.delay+t.duration*t.repeat}getTime(e){if(e===void 0)return this.time;let t=this.channels.get(e);return t===void 0?-1:t.time}setTime(e){this.time=Math.max(0,e);let t=this.channels.values();for(let o of t)this._setChannelTime(o,this.time);let i=this.animations.values();for(let o of i){let{animation:n,channel:s}=o;n.setTime(this.getTime(s))}}play(){this.playing=!0}pause(){this.playing=!1,this.lastEngineTime=-1}reset(){this.setTime(0)}attachAnimation(e,t){let i=oc++;return this.animations.set(i,{animation:e,channel:t}),e.setTime(this.getTime(t)),i}detachAnimation(e){this.animations.delete(e)}update(e){this.playing&&(this.lastEngineTime===-1&&(this.lastEngineTime=e),this.setTime(this.time+(e-this.lastEngineTime)),this.lastEngineTime=e)}_setChannelTime(e,t){let i=t-e.delay,o=e.duration*e.repeat;i>=o?e.time=e.duration*e.rate:(e.time=Math.max(0,i)%e.duration,e.time*=e.rate)}};function rs(r){let e=typeof window<"u"?window.requestAnimationFrame||window.webkitRequestAnimationFrame||window.mozRequestAnimationFrame:null;return e?e.call(window,r):setTimeout(()=>r(typeof performance<"u"?performance.now():Date.now()),1e3/60)}function os(r){let e=typeof window<"u"?window.cancelAnimationFrame||window.webkitCancelAnimationFrame||window.mozCancelAnimationFrame:null;if(e){e.call(window,r);return}clearTimeout(r)}var nc=0,sc="Animation Loop",er=class er{constructor(e){m(this,"device",null);m(this,"canvas",null);m(this,"props");m(this,"animationProps",null);m(this,"timeline",null);m(this,"stats");m(this,"sharedStats");m(this,"cpuTime");m(this,"gpuTime");m(this,"frameRate");m(this,"display");m(this,"_needsRedraw","initialized");m(this,"_initialized",!1);m(this,"_running",!1);m(this,"_animationFrameId",null);m(this,"_nextFramePromise",null);m(this,"_resolveNextFrame",null);m(this,"_cpuStartTime",0);m(this,"_error",null);m(this,"_lastFrameTime",0);if(this.props={...er.defaultAnimationLoopProps,...e},e=this.props,!e.device)throw new Error("No device provided");this.stats=e.stats||new Qe({id:`animation-loop-${nc++}`}),this.sharedStats=Lt.stats.get(sc),this.frameRate=this.stats.get("Frame Rate"),this.frameRate.setSampleSize(1),this.cpuTime=this.stats.get("CPU Time"),this.gpuTime=this.stats.get("GPU Time"),this.setProps({autoResizeViewport:e.autoResizeViewport}),this.start=this.start.bind(this),this.stop=this.stop.bind(this),this._onMousemove=this._onMousemove.bind(this),this._onMouseleave=this._onMouseleave.bind(this)}destroy(){this.stop(),this._setDisplay(null),this.device?._disableDebugGPUTime()}delete(){this.destroy()}reportError(e){this.props.onError(e),this._error=e}setNeedsRedraw(e){return this._needsRedraw=this._needsRedraw||e,this}needsRedraw(){let e=this._needsRedraw;return this._needsRedraw=!1,e}setProps(e){return"autoResizeViewport"in e&&(this.props.autoResizeViewport=e.autoResizeViewport||!1),this}async start(){if(this._running)return this;this._running=!0;try{let e;if(!this._initialized){if(this._initialized=!0,await this._initDevice(),this._initialize(),!this._running)return null;await this.props.onInitialize(this._getAnimationProps())}return this._running?(e!==!1&&(this._cancelAnimationFrame(),this._requestAnimationFrame()),this):null}catch(e){let t=e instanceof Error?e:new Error("Unknown error");throw this.props.onError(t),t}}stop(){return this._running&&(this.animationProps&&!this._error&&this.props.onFinalize(this.animationProps),this._cancelAnimationFrame(),this._nextFramePromise=null,this._resolveNextFrame=null,this._running=!1,this._lastFrameTime=0),this}redraw(e){return this.device?.isLost||this._error?this:(this._beginFrameTimers(e),this._setupFrame(),this._updateAnimationProps(),this._renderFrame(this._getAnimationProps()),this._clearNeedsRedraw(),this._resolveNextFrame&&(this._resolveNextFrame(this),this._nextFramePromise=null,this._resolveNextFrame=null),this._endFrameTimers(),this)}attachTimeline(e){return this.timeline=e,this.timeline}detachTimeline(){this.timeline=null}waitForRender(){return this.setNeedsRedraw("waitForRender"),this._nextFramePromise||(this._nextFramePromise=new Promise(e=>{this._resolveNextFrame=e})),this._nextFramePromise}async toDataURL(){if(this.setNeedsRedraw("toDataURL"),await this.waitForRender(),this.canvas instanceof HTMLCanvasElement)return this.canvas.toDataURL();throw new Error("OffscreenCanvas")}_initialize(){this._startEventHandling(),this._initializeAnimationProps(),this._updateAnimationProps(),this._resizeViewport(),this.device?._enableDebugGPUTime()}_setDisplay(e){this.display&&(this.display.destroy(),this.display.animationLoop=null),e&&(e.animationLoop=this),this.display=e}_requestAnimationFrame(){this._running&&(this._animationFrameId=rs(this._animationFrame.bind(this)))}_cancelAnimationFrame(){this._animationFrameId!==null&&(os(this._animationFrameId),this._animationFrameId=null)}_animationFrame(e){this._running&&(this.redraw(e),this._requestAnimationFrame())}_renderFrame(e){if(this.display){this.display._renderFrame(e);return}this.props.onRender(this._getAnimationProps()),this.device?.submit()}_clearNeedsRedraw(){this._needsRedraw=!1}_setupFrame(){this._resizeViewport()}_initializeAnimationProps(){let e=this.device?.getDefaultCanvasContext();if(!this.device||!e)throw new Error("loop");let t=e?.canvas,i=e.props.useDevicePixels;this.animationProps={animationLoop:this,device:this.device,canvasContext:e,canvas:t,useDevicePixels:i,timeline:this.timeline,needsRedraw:!1,width:1,height:1,aspect:1,time:0,startTime:Date.now(),engineTime:0,tick:0,tock:0,_mousePosition:null}}_getAnimationProps(){if(!this.animationProps)throw new Error("animationProps");return this.animationProps}_updateAnimationProps(){if(!this.animationProps)return;let{width:e,height:t,aspect:i}=this._getSizeAndAspect();(e!==this.animationProps.width||t!==this.animationProps.height)&&this.setNeedsRedraw("drawing buffer resized"),i!==this.animationProps.aspect&&this.setNeedsRedraw("drawing buffer aspect changed"),this.animationProps.width=e,this.animationProps.height=t,this.animationProps.aspect=i,this.animationProps.needsRedraw=this._needsRedraw,this.animationProps.engineTime=Date.now()-this.animationProps.startTime,this.timeline&&this.timeline.update(this.animationProps.engineTime),this.animationProps.tick=Math.floor(this.animationProps.time/1e3*60),this.animationProps.tock++,this.animationProps.time=this.timeline?this.timeline.getTime():this.animationProps.engineTime}async _initDevice(){if(this.device=await this.props.device,!this.device)throw new Error("No device provided");this.canvas=this.device.getDefaultCanvasContext().canvas||null}_createInfoDiv(){if(this.canvas&&this.props.onAddHTML){let e=document.createElement("div");document.body.appendChild(e),e.style.position="relative";let t=document.createElement("div");t.style.position="absolute",t.style.left="10px",t.style.bottom="10px",t.style.width="300px",t.style.background="white",this.canvas instanceof HTMLCanvasElement&&e.appendChild(this.canvas),e.appendChild(t);let i=this.props.onAddHTML(t);i&&(t.innerHTML=i)}}_getSizeAndAspect(){if(!this.device)return{width:1,height:1,aspect:1};let[e,t]=this.device.getDefaultCanvasContext().getDrawingBufferSize(),i=e>0&&t>0?e/t:1;return{width:e,height:t,aspect:i}}_resizeViewport(){this.props.autoResizeViewport&&this.device.gl&&this.device.gl.viewport(0,0,this.device.gl.drawingBufferWidth,this.device.gl.drawingBufferHeight)}_beginFrameTimers(e){let t=e??(typeof performance<"u"?performance.now():Date.now());if(this._lastFrameTime){let i=t-this._lastFrameTime;i>0&&this.frameRate.addTime(i)}this._lastFrameTime=t,this.device?._isDebugGPUTimeEnabled()&&this._consumeEncodedGpuTime(),this.cpuTime.timeStart()}_endFrameTimers(){this.device?._isDebugGPUTimeEnabled()&&this._consumeEncodedGpuTime(),this.cpuTime.timeEnd(),this._updateSharedStats()}_consumeEncodedGpuTime(){if(!this.device)return;let e=this.device.commandEncoder._gpuTimeMs;e!==void 0&&(this.gpuTime.addTime(e),this.device.commandEncoder._gpuTimeMs=void 0)}_updateSharedStats(){if(this.stats!==this.sharedStats){for(let e of Object.keys(this.sharedStats.stats))this.stats.stats[e]||delete this.sharedStats.stats[e];this.stats.forEach(e=>{let t=this.sharedStats.get(e.name,e.type);t.sampleSize=e.sampleSize,t.time=e.time,t.count=e.count,t.samples=e.samples,t.lastTiming=e.lastTiming,t.lastSampleTime=e.lastSampleTime,t.lastSampleCount=e.lastSampleCount,t._count=e._count,t._time=e._time,t._samples=e._samples,t._startTime=e._startTime,t._timerPending=e._timerPending})}}_startEventHandling(){this.canvas&&(this.canvas.addEventListener("mousemove",this._onMousemove.bind(this)),this.canvas.addEventListener("mouseleave",this._onMouseleave.bind(this)))}_onMousemove(e){e instanceof MouseEvent&&(this._getAnimationProps()._mousePosition=[e.offsetX,e.offsetY])}_onMouseleave(e){this._getAnimationProps()._mousePosition=null}};m(er,"defaultAnimationLoopProps",{device:null,onAddHTML:()=>"",onInitialize:async()=>null,onRender:()=>{},onFinalize:()=>{},onError:e=>console.error(e),stats:void 0,autoResizeViewport:!1});var Vt=er;function Be(r,e){if(!r){let t=new Error(e||"shadertools: assertion failed.");throw Error.captureStackTrace?.(t,Be),t}}var mo={number:{type:"number",validate(r,e){return Number.isFinite(r)&&typeof e=="object"&&(e.max===void 0||r<=e.max)&&(e.min===void 0||r>=e.min)}},array:{type:"array",validate(r,e){return Array.isArray(r)||ArrayBuffer.isView(r)}}};function ss(r){let e={};for(let[t,i]of Object.entries(r))e[t]=ac(i);return e}function ac(r){let e=ns(r);if(e!=="object")return{value:r,...mo[e],type:e};if(typeof r=="object")return r?r.type!==void 0?{...r,...mo[r.type],type:r.type}:r.value===void 0?{type:"object",value:r}:(e=ns(r.value),{...r,...mo[e],type:e}):{type:"object",value:null};throw new Error("props")}function ns(r){return Array.isArray(r)||ArrayBuffer.isView(r)?"array":typeof r}var as=`#ifdef MODULE_LOGDEPTH
  logdepth_adjustPosition(gl_Position);
#endif
`,ls=`#ifdef MODULE_MATERIAL
  fragColor = material_filterColor(fragColor);
#endif

#ifdef MODULE_LIGHTING
  fragColor = lighting_filterColor(fragColor);
#endif

#ifdef MODULE_FOG
  fragColor = fog_filterColor(fragColor);
#endif

#ifdef MODULE_PICKING
  fragColor = picking_filterHighlightColor(fragColor);
  fragColor = picking_filterPickingColor(fragColor);
#endif

#ifdef MODULE_LOGDEPTH
  logdepth_setFragDepth();
#endif
`;var lc={vertex:as,fragment:ls},cs=/void\s+main\s*\([^)]*\)\s*\{\n?/,fs=/}\n?[^{}]*$/,go=[],Ft="__LUMA_INJECT_DECLARATIONS__";function us(r){let e={vertex:{},fragment:{}};for(let t in r){let i=r[t],o=cc(t);typeof i=="string"&&(i={order:0,injection:i}),e[o][t]=i}return e}function cc(r){let e=r.slice(0,2);switch(e){case"vs":return"vertex";case"fs":return"fragment";default:throw new Error(e)}}function zt(r,e,t,i=!1){let o=e==="vertex";for(let n in t){let s=t[n];s.sort((l,c)=>l.order-c.order),go.length=s.length;for(let l=0,c=s.length;l<c;++l)go[l]=s[l].injection;let a=`${go.join(`
`)}
`;switch(n){case"vs:#decl":o&&(r=r.replace(Ft,a));break;case"vs:#main-start":o&&(r=r.replace(cs,l=>l+a));break;case"vs:#main-end":o&&(r=r.replace(fs,l=>a+l));break;case"fs:#decl":o||(r=r.replace(Ft,a));break;case"fs:#main-start":o||(r=r.replace(cs,l=>l+a));break;case"fs:#main-end":o||(r=r.replace(fs,l=>a+l));break;default:r=r.replace(n,l=>l+a)}}return r=r.replace(Ft,""),i&&(r=r.replace(/\}\s*$/,n=>n+lc[e])),r}function nt(r){r.map(e=>fc(e))}function fc(r){if(r.instance)return;nt(r.dependencies||[]);let{propTypes:e={},deprecations:t=[],inject:i={}}=r,o={normalizedInjections:us(i),parsedDeprecations:uc(t)};e&&(o.propValidators=ss(e)),r.instance=o;let n={};e&&(n=Object.entries(e).reduce((s,[a,l])=>{let c=l?.value;return c&&(s[a]=c),s},{})),r.defaultUniforms={...r.defaultUniforms,...n}}function _o(r,e,t){r.deprecations?.forEach(i=>{i.regex?.test(e)&&(i.deprecated?t.deprecated(i.old,i.new)():t.removed(i.old,i.new)())})}function uc(r){return r.forEach(e=>{e.type==="function"?e.regex=new RegExp(`\\b${e.old}\\(`):e.regex=new RegExp(`${e.type} ${e.old};`)}),r}function st(r){nt(r);let e={},t={};hs({modules:r,level:0,moduleMap:e,moduleDepth:t});let i=Object.keys(t).sort((o,n)=>t[n]-t[o]).map(o=>e[o]);return nt(i),i}function hs(r){let{modules:e,level:t,moduleMap:i,moduleDepth:o}=r;if(t>=5)throw new Error("Possible loop in shader dependency graph");for(let n of e)i[n.name]=n,(o[n.name]===void 0||o[n.name]<t)&&(o[n.name]=t);for(let n of e)n.dependencies&&hs({modules:n.dependencies,level:t+1,moduleMap:i,moduleDepth:o})}var hc=/^(?:uniform\s+)?(?:(?:lowp|mediump|highp)\s+)?[A-Za-z0-9_]+(?:<[^>]+>)?\s+([A-Za-z0-9_]+)(?:\s*\[[^\]]+\])?\s*;/,pc=/((?:layout\s*\([^)]*\)\s*)*)uniform\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\}\s*([A-Za-z_][A-Za-z0-9_]*)?\s*;/g;function ds(r){return`${r.name}Uniforms`}function dc(r,e){let t=e==="wgsl"?r.source:e==="vertex"?r.vs:r.fs;if(!t)return null;let i=ds(r);return gc(t,e==="wgsl"?"wgsl":"glsl",i)}function mc(r,e){let t=Object.keys(r.uniformTypes||{});if(!t.length)return null;let i=dc(r,e);return i?{moduleName:r.name,uniformBlockName:ds(r),stage:e,expectedUniformNames:t,actualUniformNames:i,matches:vc(t,i)}:null}function ms(r,e,t={}){let i=mc(r,e);if(!i||i.matches)return i;let o=yc(i);return t.log?.error?.(o,i)(),t.throwOnError!==!1&&Be(!1,o),i}function gs(r){let e=[],t=Sc(r);for(let i of t.matchAll(pc)){let o=i[1]?.trim()||null;e.push({blockName:i[2],body:i[3],instanceName:i[4]||null,layoutQualifier:o,hasLayoutQualifier:!!o,isStd140:!!(o&&/\blayout\s*\([^)]*\bstd140\b[^)]*\)/.exec(o))})}return e}function _s(r,e,t,i){let o=gs(r).filter(s=>!s.isStd140),n=new Set;for(let s of o){if(n.has(s.blockName))continue;n.add(s.blockName);let a=i?.label?`${i.label} `:"",l=s.hasLayoutQualifier?`declares ${xc(s.layoutQualifier)} instead of layout(std140)`:"does not declare layout(std140)",c=`${a}${e} shader uniform block ${s.blockName} ${l}. luma.gl host-side shader block packing assumes explicit layout(std140) for GLSL uniform blocks. Add \`layout(std140)\` to the block declaration.`;t?.warn?.(c,s)()}return o}function gc(r,e,t){let i=e==="wgsl"?_c(r,t):bc(r,t);if(!i)return null;let o=[];for(let n of i.split(`
`)){let s=n.replace(/\/\/.*$/,"").trim();if(!s||s.startsWith("#"))continue;let a=e==="wgsl"?s.match(/^([A-Za-z0-9_]+)\s*:/):s.match(hc);a&&o.push(a[1])}return o}function _c(r,e){let t=new RegExp(`\\bstruct\\s+${e}\\b`,"m").exec(r);if(!t)return null;let i=r.indexOf("{",t.index);if(i<0)return null;let o=0;for(let n=i;n<r.length;n++){let s=r[n];if(s==="{"){o++;continue}if(s==="}"&&(o--,o===0))return r.slice(i+1,n)}return null}function bc(r,e){return gs(r).find(i=>i.blockName===e)?.body||null}function vc(r,e){if(r.length!==e.length)return!1;for(let t=0;t<r.length;t++)if(r[t]!==e[t])return!1;return!0}function yc(r){let{expectedUniformNames:e,actualUniformNames:t}=r,i=e.filter(a=>!t.includes(a)),o=t.filter(a=>!e.includes(a)),n=[`Expected ${e.length} fields, found ${t.length}.`],s=wc(e,t);return s&&n.push(s),i.length&&n.push(`Missing from shader block (${i.length}): ${ps(i)}.`),o.length&&n.push(`Unexpected in shader block (${o.length}): ${ps(o)}.`),e.length<=12&&t.length<=12&&(i.length||o.length)&&(n.push(`Expected: ${e.join(", ")}.`),n.push(`Actual: ${t.join(", ")}.`)),`${r.moduleName}: ${r.stage} shader uniform block ${r.uniformBlockName} does not match module.uniformTypes. ${n.join(" ")}`}function Sc(r){return r.replace(/\/\*[\s\S]*?\*\//g,"").replace(/\/\/.*$/gm,"")}function xc(r){return r.replace(/\s+/g," ").trim()}function wc(r,e){let t=Math.min(r.length,e.length);for(let i=0;i<t;i++)if(r[i]!==e[i])return`First mismatch at field ${i+1}: expected ${r[i]}, found ${e[i]}.`;return r.length>e.length?`Shader block ends after field ${e.length}; expected next field ${r[e.length]}.`:e.length>r.length?`Shader block has extra field ${e.length}: ${e[r.length]}.`:null}function ps(r,e=8){if(r.length<=e)return r.join(", ");let t=r.length-e;return`${r.slice(0,e).join(", ")}, ... (${t} more)`}function bs(r){switch(r?.gpu.toLowerCase()){case"apple":return`#define APPLE_GPU
// Apple optimizes away the calculation necessary for emulated fp64
#define LUMA_FP64_CODE_ELIMINATION_WORKAROUND 1
#define LUMA_FP32_TAN_PRECISION_WORKAROUND 1
// Intel GPU doesn't have full 32 bits precision in same cases, causes overflow
#define LUMA_FP64_HIGH_BITS_OVERFLOW_WORKAROUND 1
`;case"nvidia":return`#define NVIDIA_GPU
// Nvidia optimizes away the calculation necessary for emulated fp64
#define LUMA_FP64_CODE_ELIMINATION_WORKAROUND 1
`;case"intel":return`#define INTEL_GPU
// Intel optimizes away the calculation necessary for emulated fp64
#define LUMA_FP64_CODE_ELIMINATION_WORKAROUND 1
// Intel's built-in 'tan' function doesn't have acceptable precision
#define LUMA_FP32_TAN_PRECISION_WORKAROUND 1
// Intel GPU doesn't have full 32 bits precision in same cases, causes overflow
#define LUMA_FP64_HIGH_BITS_OVERFLOW_WORKAROUND 1
`;case"amd":return`#define AMD_GPU
`;default:return`#define DEFAULT_GPU
// Prevent driver from optimizing away the calculation necessary for emulated fp64
#define LUMA_FP64_CODE_ELIMINATION_WORKAROUND 1
// Headless Chrome's software shader 'tan' function doesn't have acceptable precision
#define LUMA_FP32_TAN_PRECISION_WORKAROUND 1
// If the GPU doesn't have full 32 bits precision, will causes overflow
#define LUMA_FP64_HIGH_BITS_OVERFLOW_WORKAROUND 1
`}}function ys(r,e){if(Number(r.match(/^#version[ \t]+(\d+)/m)?.[1]||100)!==300)throw new Error("luma.gl v9 only supports GLSL 3.00 shader sources");switch(e){case"vertex":return r=vs(r,Ec),r;case"fragment":return r=vs(r,Mc),r;default:throw new Error(e)}}var Ss=[[/^(#version[ \t]+(100|300[ \t]+es))?[ \t]*\n/,`#version 300 es
`],[/\btexture(2D|2DProj|Cube)Lod(EXT)?\(/g,"textureLod("],[/\btexture(2D|2DProj|Cube)(EXT)?\(/g,"texture("]],Ec=[...Ss,[bo("attribute"),"in $1"],[bo("varying"),"out $1"]],Mc=[...Ss,[bo("varying"),"in $1"]];function vs(r,e){for(let[t,i]of e)r=r.replace(t,i);return r}function bo(r){return new RegExp(`\\b${r}[ \\t]+(\\w+[ \\t]+\\w+(\\[\\w+\\])?;)`,"g")}function vo(r,e){let t="";for(let i in r){let o=r[i];if(t+=`void ${o.signature} {
`,o.header&&(t+=`  ${o.header}`),e[i]){let n=e[i];n.sort((s,a)=>s.order-a.order);for(let s of n)t+=`  ${s.injection}
`}o.footer&&(t+=`  ${o.footer}`),t+=`}
`}return t}function yo(r){let e={vertex:{},fragment:{}};for(let t of r){let i,o;typeof t!="string"?(i=t,o=i.hook):(i={},o=t),o=o.trim();let[n,s]=o.split(":"),a=o.replace(/\(.+/,""),l=Object.assign(i,{signature:s});switch(n){case"vs":e.vertex[a]=l;break;case"fs":e.fragment[a]=l;break;default:throw new Error(n)}}return e}function xs(r,e){return{name:Pc(r,e),language:"glsl",version:Tc(r)}}function Pc(r,e="unnamed"){let i=/#define[^\S\r\n]*SHADER_NAME[^\S\r\n]*([A-Za-z0-9_-]+)\s*/.exec(r);return i?i[1]:e}function Tc(r){let e=100,t=r.match(/[^\s]+/g);if(t&&t.length>=2&&t[0]==="#version"){let i=parseInt(t[1],10);Number.isFinite(i)&&(e=i)}if(e!==100&&e!==300)throw new Error(`Invalid GLSL version ${e}`);return e}var q="(?:var<\\s*(uniform|storage(?:\\s*,\\s*[A-Za-z_][A-Za-z0-9_]*)?)\\s*>|var)\\s+([A-Za-z_][A-Za-z0-9_]*)";var at=[new RegExp(`@binding\\(\\s*(auto|\\d+)\\s*\\)\\s*@group\\(\\s*(\\d+)\\s*\\)\\s*${q}`,"g"),new RegExp(`@group\\(\\s*(\\d+)\\s*\\)\\s*@binding\\(\\s*(auto|\\d+)\\s*\\)\\s*${q}`,"g")],tr=[new RegExp(`@binding\\(\\s*(auto|\\d+)\\s*\\)\\s*@group\\(\\s*(\\d+)\\s*\\)\\s*${q}`,"g"),new RegExp(`@group\\(\\s*(\\d+)\\s*\\)\\s*@binding\\(\\s*(auto|\\d+)\\s*\\)\\s*${q}`,"g")],ws=[new RegExp(`@binding\\(\\s*(\\d+)\\s*\\)\\s*@group\\(\\s*(\\d+)\\s*\\)\\s*${q}`,"g"),new RegExp(`@group\\(\\s*(\\d+)\\s*\\)\\s*@binding\\(\\s*(\\d+)\\s*\\)\\s*${q}`,"g")],Ac=[new RegExp(`@binding\\(\\s*(auto)\\s*\\)\\s*@group\\(\\s*(\\d+)\\s*\\)\\s*${q}`,"g"),new RegExp(`@group\\(\\s*(\\d+)\\s*\\)\\s*@binding\\(\\s*(auto)\\s*\\)\\s*${q}`,"g"),new RegExp(`@binding\\(\\s*(auto)\\s*\\)\\s*@group\\(\\s*(\\d+)\\s*\\)(?:[\\s\\n\\r]*@[A-Za-z_][^\\n\\r]*)*[\\s\\n\\r]*${q}`,"g"),new RegExp(`@group\\(\\s*(\\d+)\\s*\\)\\s*@binding\\(\\s*(auto)\\s*\\)(?:[\\s\\n\\r]*@[A-Za-z_][^\\n\\r]*)*[\\s\\n\\r]*${q}`,"g")];function ir(r){let e=r.split(""),t=0,i=0,o=!1,n=!1,s=!1;for(;t<r.length;){let a=r[t],l=r[t+1];if(n){s?s=!1:a==="\\"?s=!0:a==='"'&&(n=!1),t++;continue}if(o){a===`
`||a==="\r"?o=!1:e[t]=" ",t++;continue}if(i>0){if(a==="/"&&l==="*"){e[t]=" ",e[t+1]=" ",i++,t+=2;continue}if(a==="*"&&l==="/"){e[t]=" ",e[t+1]=" ",i--,t+=2;continue}a!==`
`&&a!=="\r"&&(e[t]=" "),t++;continue}if(a==='"'){n=!0,t++;continue}if(a==="/"&&l==="/"){e[t]=" ",e[t+1]=" ",o=!0,t+=2;continue}if(a==="/"&&l==="*"){e[t]=" ",e[t+1]=" ",i=1,t+=2;continue}t++}return e.join("")}function Ve(r,e){let t=ir(r),i=[];for(let o of e){o.lastIndex=0;let n;for(n=o.exec(t);n;){let s=o===e[0],a=n.index,l=n[0].length;i.push({match:r.slice(a,a+l),index:a,length:l,bindingToken:n[s?1:2],groupToken:n[s?2:1],accessDeclaration:n[3]?.trim(),name:n[4]}),n=o.exec(t)}}return i.sort((o,n)=>o.index-n.index)}function So(r,e,t){let i=Ve(r,e);if(!i.length)return r;let o="",n=0;for(let s of i)o+=r.slice(n,s.index),o+=t(s),n=s.index+s.length;return o+=r.slice(n),o}function xo(r){return/@binding\(\s*auto\s*\)/.test(ir(r))}function Es(r,e){return Ve(r,e===at||e===tr?Ac:e).find(i=>i.bindingToken==="auto")}var Ms=[new RegExp(`@binding\\(\\s*(\\d+)\\s*\\)\\s*@group\\(\\s*(\\d+)\\s*\\)\\s*${q}\\s*:\\s*([^;]+);`,"g"),new RegExp(`@group\\(\\s*(\\d+)\\s*\\)\\s*@binding\\(\\s*(\\d+)\\s*\\)\\s*${q}\\s*:\\s*([^;]+);`,"g")];function rr(r,e=[]){let t=ir(r),i=new Map;for(let n of e)i.set(Ps(n.name,n.group,n.location),n.moduleName);let o=[];for(let n of Ms){n.lastIndex=0;let s;for(s=n.exec(t);s;){let a=n===Ms[0],l=Number(s[a?1:2]),c=Number(s[a?2:1]),f=s[3]?.trim(),u=s[4],h=s[5].trim(),p=i.get(Ps(u,c,l));o.push(Cc({name:u,group:c,binding:l,owner:p?"module":"application",moduleName:p,accessDeclaration:f,resourceType:h})),s=n.exec(t)}}return o.sort((n,s)=>n.group!==s.group?n.group-s.group:n.binding!==s.binding?n.binding-s.binding:n.name.localeCompare(s.name))}function Cc(r){let e={name:r.name,group:r.group,binding:r.binding,owner:r.owner,kind:"unknown",moduleName:r.moduleName,resourceType:r.resourceType};if(r.accessDeclaration){let t=r.accessDeclaration.split(",").map(i=>i.trim());if(t[0]==="uniform")return{...e,kind:"uniform",access:"uniform"};if(t[0]==="storage"){let i=t[1]||"read_write";return{...e,kind:i==="read"?"read-only-storage":"storage",access:i}}}return r.resourceType==="sampler"||r.resourceType==="sampler_comparison"?{...e,kind:"sampler",samplerKind:r.resourceType==="sampler_comparison"?"comparison":"filtering"}:r.resourceType.startsWith("texture_storage_")?{...e,kind:"storage-texture",access:Rc(r.resourceType),viewDimension:Ts(r.resourceType)}:r.resourceType.startsWith("texture_")?{...e,kind:"texture",viewDimension:Ts(r.resourceType),sampleType:Lc(r.resourceType),multisampled:r.resourceType.startsWith("texture_multisampled_")}:e}function Ps(r,e,t){return`${e}:${t}:${r}`}function Ts(r){if(r.includes("cube_array"))return"cube-array";if(r.includes("2d_array"))return"2d-array";if(r.includes("cube"))return"cube";if(r.includes("3d"))return"3d";if(r.includes("2d"))return"2d";if(r.includes("1d"))return"1d"}function Lc(r){if(r.startsWith("texture_depth_"))return"depth";if(r.includes("<i32>"))return"sint";if(r.includes("<u32>"))return"uint";if(r.includes("<f32>"))return"float"}function Rc(r){return/,\s*([A-Za-z_][A-Za-z0-9_]*)\s*>$/.exec(r)?.[1]}var wo=`

${Ft}
`,jt=100,Ic=`precision highp float;
`;function Rs(r){let e=st(r.modules||[]),{source:t,bindingAssignments:i}=Oc(r.platformInfo,{...r,source:r.source,stage:"vertex",modules:e});return{source:t,getUniforms:Os(e),bindingAssignments:i,bindingTable:rr(t,i)}}function Is(r){let{vs:e,fs:t}=r,i=st(r.modules||[]);return{vs:As(r.platformInfo,{...r,source:e,stage:"vertex",modules:i}),fs:As(r.platformInfo,{...r,source:t,stage:"fragment",modules:i}),getUniforms:Os(i)}}function Oc(r,e){let{source:t,stage:i,modules:o,hookFunctions:n=[],inject:s={},log:a}=e;Be(typeof t=="string","shader source must be a string");let l=t,c="",f=yo(n),u={},h={},p={};for(let _ in s){let S=typeof s[_]=="string"?{injection:s[_],order:0}:s[_],P=/^(v|f)s:(#)?([\w-]+)$/.exec(_);if(P){let x=P[2],E=P[3];x?E==="decl"?h[_]=[S]:p[_]=[S]:u[_]=[S]}else p[_]=[S]}let d=o,g=Dc(l),b=Uc(g.source),v=Fc(d,e._bindingRegistry,b),y=[];for(let _ of d){a&&_o(_,l,a);let S=kc(Ns(_,"wgsl",a),_,{usedBindingsByGroup:b,bindingRegistry:e._bindingRegistry,reservedBindingKeysByGroup:v});y.push(...S.bindingAssignments);let P=S.source;c+=P;let x=_.injections?.[i]||{};for(let E in x){let C=/^(v|f)s:#([\w-]+)$/.exec(E);if(C){let A=C[2]==="decl"?h:p;A[E]=A[E]||[],A[E].push(x[E])}else u[E]=u[E]||[],u[E].push(x[E])}}return c+=wo,c=zt(c,i,h),c+=vo(f[i],u),c+=Wc(y),c+=g.source,c=zt(c,i,p),Hc(c),{source:c,bindingAssignments:y}}function As(r,e){let{source:t,stage:i,language:o="glsl",modules:n,defines:s={},hookFunctions:a=[],inject:l={},prologue:c=!0,log:f}=e;Be(typeof t=="string","shader source must be a string");let u=o==="glsl"?xs(t).version:-1,h=r.shaderLanguageVersion,p=u===100?"#version 100":"#version 300 es",g=t.split(`
`).slice(1).join(`
`),b={};n.forEach(x=>{Object.assign(b,x.defines)}),Object.assign(b,s);let v="";switch(o){case"wgsl":break;case"glsl":v=c?`${p}

// ----- PROLOGUE -------------------------
${`#define SHADER_TYPE_${i.toUpperCase()}`}

${bs(r)}
${i==="fragment"?Ic:""}

// ----- APPLICATION DEFINES -------------------------

${Nc(b)}

`:`${p}
`;break}let y=yo(a),_={},S={},P={};for(let x in l){let E=typeof l[x]=="string"?{injection:l[x],order:0}:l[x],C=/^(v|f)s:(#)?([\w-]+)$/.exec(x);if(C){let T=C[2],A=C[3];T?A==="decl"?S[x]=[E]:P[x]=[E]:_[x]=[E]}else P[x]=[E]}for(let x of n){f&&_o(x,g,f);let E=Ns(x,i,f);v+=E;let C=x.instance?.normalizedInjections[i]||{};for(let T in C){let A=/^(v|f)s:#([\w-]+)$/.exec(T);if(A){let G=A[2]==="decl"?S:P;G[T]=G[T]||[],G[T].push(C[T])}else _[T]=_[T]||[],_[T].push(C[T])}}return v+="// ----- MAIN SHADER SOURCE -------------------------",v+=wo,v=zt(v,i,S),v+=vo(y[i],_),v+=g,v=zt(v,i,P),o==="glsl"&&u!==h&&(v=ys(v,i)),o==="glsl"&&_s(v,i,f),v.trim()}function Os(r){return function(t){let i={};for(let o of r){let n=o.getUniforms?.(t,i);Object.assign(i,n)}return i}}function Nc(r={}){let e="";for(let t in r){let i=r[t];(i||Number.isFinite(i))&&(e+=`#define ${t.toUpperCase()} ${r[t]}
`)}return e}function Ns(r,e,t){let i;switch(e){case"vertex":i=r.vs||"";break;case"fragment":i=r.fs||"";break;case"wgsl":i=r.source||"";break;default:Be(!1)}if(!r.name)throw new Error("Shader module must have a name");ms(r,e,{log:t});let o=r.name.toUpperCase().replace(/[^0-9a-z]/gi,"_"),n=`// ----- MODULE ${r.name} ---------------

`;return e!=="wgsl"&&(n+=`#define MODULE_${o}
`),n+=`${i}
`,n}function Uc(r){let e=new Map;for(let t of Ve(r,ws)){let i=Number(t.bindingToken),o=Number(t.groupToken);Eo(o,i,t.name),lt(e,o,i,`application binding "${t.name}"`)}return e}function Dc(r){let e=Ve(r,tr),t=new Map;for(let n of e){if(n.bindingToken==="auto")continue;let s=Number(n.bindingToken),a=Number(n.groupToken);Eo(a,s,n.name),lt(t,a,s,`application binding "${n.name}"`)}let i={sawSupportedBindingDeclaration:e.length>0},o=So(r,tr,n=>Vc(n,t,i));if(xo(r)&&!i.sawSupportedBindingDeclaration)throw new Error('Unsupported @binding(auto) declaration form in application WGSL. Use adjacent "@group(N)" and "@binding(auto)" decorators followed by a bindable "var" declaration.');return{source:o}}function kc(r,e,t){let i=[],n={sawSupportedBindingDeclaration:Ve(r,at).length>0,nextHintedBindingLocation:typeof e.firstBindingSlot=="number"?e.firstBindingSlot:null},s=So(r,at,a=>Bc(a,{module:e,context:t,bindingAssignments:i,relocationState:n}));if(xo(r)&&!n.sawSupportedBindingDeclaration)throw new Error(`Unsupported @binding(auto) declaration form in module "${e.name}". Use adjacent "@group(N)" and "@binding(auto)" decorators followed by a bindable "var" declaration.`);return{source:s,bindingAssignments:i}}function Bc(r,e){let{module:t,context:i,bindingAssignments:o,relocationState:n}=e,{match:s,bindingToken:a,groupToken:l,name:c}=r,f=Number(l);if(a==="auto"){let h=Us(f,t.name,c),p=i.bindingRegistry?.get(h),d=p!==void 0?p:n.nextHintedBindingLocation===null?Ls(f,i.usedBindingsByGroup):Ls(f,i.usedBindingsByGroup,n.nextHintedBindingLocation);return Cs(t.name,f,d,c),p!==void 0&&zc(i.reservedBindingKeysByGroup,f,d,h)?(o.push({moduleName:t.name,name:c,group:f,location:d}),s.replace(/@binding\(\s*auto\s*\)/,`@binding(${d})`)):(lt(i.usedBindingsByGroup,f,d,`module "${t.name}" binding "${c}"`),i.bindingRegistry?.set(h,d),o.push({moduleName:t.name,name:c,group:f,location:d}),n.nextHintedBindingLocation!==null&&p===void 0&&(n.nextHintedBindingLocation=d+1),s.replace(/@binding\(\s*auto\s*\)/,`@binding(${d})`))}let u=Number(a);return Cs(t.name,f,u,c),lt(i.usedBindingsByGroup,f,u,`module "${t.name}" binding "${c}"`),o.push({moduleName:t.name,name:c,group:f,location:u}),s}function Vc(r,e,t){let{match:i,bindingToken:o,groupToken:n,name:s}=r,a=Number(n);if(o==="auto"){let l=Gc(a,e);return Eo(a,l,s),lt(e,a,l,`application binding "${s}"`),i.replace(/@binding\(\s*auto\s*\)/,`@binding(${l})`)}return t.sawSupportedBindingDeclaration=!0,i}function Fc(r,e,t){let i=new Map;if(!e)return i;for(let o of r)for(let n of jc(o)){let s=Us(n.group,o.name,n.name),a=e.get(s);if(a!==void 0){let l=i.get(n.group)||new Map,c=l.get(a);if(c&&c!==s)throw new Error(`Duplicate WGSL binding reservation for modules "${c}" and "${s}": group ${n.group}, binding ${a}.`);lt(t,n.group,a,`registered module binding "${s}"`),l.set(a,s),i.set(n.group,l)}}return i}function zc(r,e,t,i){let o=r.get(e);if(!o)return!1;let n=o.get(t);if(!n)return!1;if(n!==i)throw new Error(`Registered module binding "${i}" collided with "${n}": group ${e}, binding ${t}.`);return!0}function jc(r){let e=[],t=r.source||"";for(let i of Ve(t,at))e.push({name:i.name,group:Number(i.groupToken)});return e}function Eo(r,e,t){if(r===0&&e>=jt)throw new Error(`Application binding "${t}" in group 0 uses reserved binding ${e}. Application-owned explicit group-0 bindings must stay below ${jt}.`)}function Cs(r,e,t,i){if(e===0&&t<jt)throw new Error(`Module "${r}" binding "${i}" in group 0 uses reserved application binding ${t}. Module-owned explicit group-0 bindings must be ${jt} or higher.`)}function lt(r,e,t,i){let o=r.get(e)||new Set;if(o.has(t))throw new Error(`Duplicate WGSL binding assignment for ${i}: group ${e}, binding ${t}.`);o.add(t),r.set(e,o)}function Ls(r,e,t){let i=e.get(r)||new Set,o=t??(r===0?jt:i.size>0?Math.max(...i)+1:0);for(;i.has(o);)o++;return o}function Gc(r,e){let t=e.get(r)||new Set,i=0;for(;t.has(i);)i++;return i}function Hc(r){let e=Es(r,at);if(!e)return;let t=$c(r,e.index);throw t?new Error(`Unresolved @binding(auto) for module "${t}" binding "${e.name}" remained in assembled WGSL source.`):Yc(r,e.index)?new Error(`Unresolved @binding(auto) for application binding "${e.name}" remained in assembled WGSL source.`):new Error(`Unresolved @binding(auto) remained in assembled WGSL source near "${qc(e.match)}".`)}function Wc(r){if(r.length===0)return"";let e=`// ----- MODULE WGSL BINDING ASSIGNMENTS ---------------
`;for(let t of r)e+=`// ${t.moduleName}.${t.name} -> @group(${t.group}) @binding(${t.location})
`;return e+=`
`,e}function Us(r,e,t){return`${r}:${e}:${t}`}function $c(r,e){let t=/^\/\/ ----- MODULE ([^\n]+) ---------------$/gm,i,o;for(o=t.exec(r);o&&o.index<=e;)i=o[1],o=t.exec(r);return i}function Yc(r,e){let t=r.indexOf(wo);return t>=0?e>t:!0}function qc(r){return r.replace(/\s+/g," ").trim()}var Mo="([a-zA-Z_][a-zA-Z0-9_]*)",Xc=new RegExp(`^\\s*\\#\\s*ifdef\\s*${Mo}\\s*$`),Zc=new RegExp(`^\\s*\\#\\s*ifndef\\s*${Mo}\\s*(?:\\/\\/.*)?$`),Kc=/^\s*\#\s*else\s*(?:\/\/.*)?$/,Jc=/^\s*\#\s*endif\s*$/,Qc=new RegExp(`^\\s*\\#\\s*ifdef\\s*${Mo}\\s*(?:\\/\\/.*)?$`),ef=/^\s*\#\s*endif\s*(?:\/\/.*)?$/;function Ds(r,e){let t=r.split(`
`),i=[],o=[],n=!0;for(let s of t){let a=s.match(Qc)||s.match(Xc),l=s.match(Zc),c=s.match(Kc),f=s.match(ef)||s.match(Jc);if(a||l){let u=(a||l)?.[1],h=!!e?.defines?.[u],p=a?h:!h,d=n&&p;o.push({parentActive:n,branchTaken:p,active:d}),n=d}else if(c){let u=o[o.length-1];if(!u)throw new Error("Encountered #else without matching #ifdef or #ifndef");u.active=u.parentActive&&!u.branchTaken,u.branchTaken=!0,n=u.active}else f?(o.pop(),n=o.length?o[o.length-1].active:!0):n&&i.push(s)}if(o.length>0)throw new Error("Unterminated conditional block in shader source");return i.join(`
`)}var Fe=class Fe{constructor(){m(this,"_hookFunctions",[]);m(this,"_defaultModules",[]);m(this,"_wgslBindingRegistry",new Map)}static getDefaultShaderAssembler(){return Fe.defaultShaderAssembler=Fe.defaultShaderAssembler||new Fe,Fe.defaultShaderAssembler}addDefaultModule(e){this._defaultModules.find(t=>t.name===(typeof e=="string"?e:e.name))||this._defaultModules.push(e)}removeDefaultModule(e){let t=typeof e=="string"?e:e.name;this._defaultModules=this._defaultModules.filter(i=>i.name!==t)}addShaderHook(e,t){t&&(e=Object.assign(t,{hook:e})),this._hookFunctions.push(e)}assembleWGSLShader(e){let t=this._getModuleList(e.modules),i=this._hookFunctions,{source:o,getUniforms:n,bindingAssignments:s}=Rs({...e,source:e.source,_bindingRegistry:this._wgslBindingRegistry,modules:t,hookFunctions:i}),a={...t.reduce((c,f)=>(Object.assign(c,f.defines),c),{}),...e.defines},l=e.platformInfo.shaderLanguage==="wgsl"?Ds(o,{defines:a}):o;return{source:l,getUniforms:n,modules:t,bindingAssignments:s,bindingTable:rr(l,s)}}assembleGLSLShaderPair(e){let t=this._getModuleList(e.modules),i=this._hookFunctions;return{...Is({...e,vs:e.vs,fs:e.fs,modules:t,hookFunctions:i}),modules:t}}_getModuleList(e=[]){let t=new Array(this._defaultModules.length+e.length),i={},o=0;for(let n=0,s=this._defaultModules.length;n<s;++n){let a=this._defaultModules[n],l=a.name;t[o++]=a,i[l]=!0}for(let n=0,s=e.length;n<s;++n){let a=e[n],l=a.name;i[l]||(t[o++]=a,i[l]=!0)}return t.length=o,nt(t),t}};m(Fe,"defaultShaderAssembler");var ze=Fe;var tf=`out vec4 transform_output;
void main() {
  transform_output = vec4(0);
}`,rf=`#version 300 es
${tf}`;function Po(r){let{input:e,inputChannels:t,output:i}=r||{};if(!e)return rf;if(!t)throw new Error("inputChannels");let o=of(t),n=ks(e,t);return`#version 300 es
in ${o} ${e};
out vec4 ${i};
void main() {
  ${i} = ${n};
}`}function of(r){switch(r){case 1:return"float";case 2:return"vec2";case 3:return"vec3";case 4:return"vec4";default:throw new Error(`invalid channels: ${r}`)}}function ks(r,e){switch(e){case 1:return`vec4(${r}, 0.0, 0.0, 1.0)`;case 2:return`vec4(${r}, 0.0, 1.0)`;case 3:return`vec4(${r}, 1.0)`;case 4:return r;default:throw new Error(`invalid channels: ${e}`)}}function To(r,e=[],t=0){let i=Math.fround(r),o=r-i;return e[t]=i,e[t+1]=o,e}function Bs(r){return r-Math.fround(r)}function Vs(r){let e=new Float32Array(32);for(let t=0;t<4;++t)for(let i=0;i<4;++i){let o=t*4+i;To(r[i*4+t],e,o*2)}return e}function Gt(r,e=!0){return r??e}function or(r=[0,0,0],e=!0){return e?r.map(t=>t/255):[...r]}function Ao(r,e=!0){let t=or(r.slice(0,3),e),i=Number.isFinite(r[3]),o=i?r[3]:1;return[t[0],t[1],t[2],e&&i?o/255:o]}var nf=`#ifdef LUMA_FP32_TAN_PRECISION_WORKAROUND

// All these functions are for substituting tan() function from Intel GPU only
const float TWO_PI = 6.2831854820251465;
const float PI_2 = 1.5707963705062866;
const float PI_16 = 0.1963495463132858;

const float SIN_TABLE_0 = 0.19509032368659973;
const float SIN_TABLE_1 = 0.3826834261417389;
const float SIN_TABLE_2 = 0.5555702447891235;
const float SIN_TABLE_3 = 0.7071067690849304;

const float COS_TABLE_0 = 0.9807852506637573;
const float COS_TABLE_1 = 0.9238795042037964;
const float COS_TABLE_2 = 0.8314695954322815;
const float COS_TABLE_3 = 0.7071067690849304;

const float INVERSE_FACTORIAL_3 = 1.666666716337204e-01; // 1/3!
const float INVERSE_FACTORIAL_5 = 8.333333767950535e-03; // 1/5!
const float INVERSE_FACTORIAL_7 = 1.9841270113829523e-04; // 1/7!
const float INVERSE_FACTORIAL_9 = 2.75573188446287533e-06; // 1/9!

float sin_taylor_fp32(float a) {
  float r, s, t, x;

  if (a == 0.0) {
    return 0.0;
  }

  x = -a * a;
  s = a;
  r = a;

  r = r * x;
  t = r * INVERSE_FACTORIAL_3;
  s = s + t;

  r = r * x;
  t = r * INVERSE_FACTORIAL_5;
  s = s + t;

  r = r * x;
  t = r * INVERSE_FACTORIAL_7;
  s = s + t;

  r = r * x;
  t = r * INVERSE_FACTORIAL_9;
  s = s + t;

  return s;
}

void sincos_taylor_fp32(float a, out float sin_t, out float cos_t) {
  if (a == 0.0) {
    sin_t = 0.0;
    cos_t = 1.0;
  }
  sin_t = sin_taylor_fp32(a);
  cos_t = sqrt(1.0 - sin_t * sin_t);
}

float tan_taylor_fp32(float a) {
    float sin_a;
    float cos_a;

    if (a == 0.0) {
        return 0.0;
    }

    // 2pi range reduction
    float z = floor(a / TWO_PI);
    float r = a - TWO_PI * z;

    float t;
    float q = floor(r / PI_2 + 0.5);
    int j = int(q);

    if (j < -2 || j > 2) {
        return 1.0 / 0.0;
    }

    t = r - PI_2 * q;

    q = floor(t / PI_16 + 0.5);
    int k = int(q);
    int abs_k = int(abs(float(k)));

    if (abs_k > 4) {
        return 1.0 / 0.0;
    } else {
        t = t - PI_16 * q;
    }

    float u = 0.0;
    float v = 0.0;

    float sin_t, cos_t;
    float s, c;
    sincos_taylor_fp32(t, sin_t, cos_t);

    if (k == 0) {
        s = sin_t;
        c = cos_t;
    } else {
        if (abs(float(abs_k) - 1.0) < 0.5) {
            u = COS_TABLE_0;
            v = SIN_TABLE_0;
        } else if (abs(float(abs_k) - 2.0) < 0.5) {
            u = COS_TABLE_1;
            v = SIN_TABLE_1;
        } else if (abs(float(abs_k) - 3.0) < 0.5) {
            u = COS_TABLE_2;
            v = SIN_TABLE_2;
        } else if (abs(float(abs_k) - 4.0) < 0.5) {
            u = COS_TABLE_3;
            v = SIN_TABLE_3;
        }
        if (k > 0) {
            s = u * sin_t + v * cos_t;
            c = u * cos_t - v * sin_t;
        } else {
            s = u * sin_t - v * cos_t;
            c = u * cos_t + v * sin_t;
        }
    }

    if (j == 0) {
        sin_a = s;
        cos_a = c;
    } else if (j == 1) {
        sin_a = c;
        cos_a = -s;
    } else if (j == -1) {
        sin_a = -c;
        cos_a = s;
    } else {
        sin_a = -s;
        cos_a = -c;
    }
    return sin_a / cos_a;
}
#endif

float tan_fp32(float a) {
#ifdef LUMA_FP32_TAN_PRECISION_WORKAROUND
  return tan_taylor_fp32(a);
#else
  return tan(a);
#endif
}
`,Co={name:"fp32",vs:nf};var Lo=`
layout(std140) uniform fp64arithmeticUniforms {
  uniform float ONE;
  uniform float SPLIT;
} fp64;

/*
About LUMA_FP64_CODE_ELIMINATION_WORKAROUND

The purpose of this workaround is to prevent shader compilers from
optimizing away necessary arithmetic operations by swapping their sequences
or transform the equation to some 'equivalent' form.

These helpers implement Dekker/Veltkamp-style error tracking. If the compiler
folds constants or reassociates the arithmetic, the high/low split can stop
tracking the rounding error correctly. That failure mode tends to look fine in
simple coordinate setup, but then breaks down inside iterative arithmetic such
as fp64 Mandelbrot loops.

The method is to multiply an artifical variable, ONE, which will be known to
the compiler to be 1 only at runtime. The whole expression is then represented
as a polynomial with respective to ONE. In the coefficients of all terms, only one a
and one b should appear

err = (a + b) * ONE^6 - a * ONE^5 - (a + b) * ONE^4 + a * ONE^3 - b - (a + b) * ONE^2 + a * ONE
*/

float prevent_fp64_optimization(float value) {
#if defined(LUMA_FP64_CODE_ELIMINATION_WORKAROUND)
  return value + fp64.ONE * 0.0;
#else
  return value;
#endif
}

// Divide float number to high and low floats to extend fraction bits
vec2 split(float a) {
  // Keep SPLIT as a runtime uniform so the compiler cannot fold the Dekker
  // split into a constant expression and reassociate the recovery steps.
  float split = prevent_fp64_optimization(fp64.SPLIT);
  float t = prevent_fp64_optimization(a * split);
  float temp = t - a;
  float a_hi = t - temp;
  float a_lo = a - a_hi;
  return vec2(a_hi, a_lo);
}

// Divide float number again when high float uses too many fraction bits
vec2 split2(vec2 a) {
  vec2 b = split(a.x);
  b.y += a.y;
  return b;
}

// Special sum operation when a > b
vec2 quickTwoSum(float a, float b) {
#if defined(LUMA_FP64_CODE_ELIMINATION_WORKAROUND)
  float sum = (a + b) * fp64.ONE;
  float err = b - (sum - a) * fp64.ONE;
#else
  float sum = a + b;
  float err = b - (sum - a);
#endif
  return vec2(sum, err);
}

// General sum operation
vec2 twoSum(float a, float b) {
  float s = (a + b);
#if defined(LUMA_FP64_CODE_ELIMINATION_WORKAROUND)
  float v = (s * fp64.ONE - a) * fp64.ONE;
  float err = (a - (s - v) * fp64.ONE) * fp64.ONE * fp64.ONE * fp64.ONE + (b - v);
#else
  float v = s - a;
  float err = (a - (s - v)) + (b - v);
#endif
  return vec2(s, err);
}

vec2 twoSub(float a, float b) {
  float s = (a - b);
#if defined(LUMA_FP64_CODE_ELIMINATION_WORKAROUND)
  float v = (s * fp64.ONE - a) * fp64.ONE;
  float err = (a - (s - v) * fp64.ONE) * fp64.ONE * fp64.ONE * fp64.ONE - (b + v);
#else
  float v = s - a;
  float err = (a - (s - v)) - (b + v);
#endif
  return vec2(s, err);
}

vec2 twoSqr(float a) {
  float prod = a * a;
  vec2 a_fp64 = split(a);
#if defined(LUMA_FP64_CODE_ELIMINATION_WORKAROUND)
  float err = ((a_fp64.x * a_fp64.x - prod) * fp64.ONE + 2.0 * a_fp64.x *
    a_fp64.y * fp64.ONE * fp64.ONE) + a_fp64.y * a_fp64.y * fp64.ONE * fp64.ONE * fp64.ONE;
#else
  float err = ((a_fp64.x * a_fp64.x - prod) + 2.0 * a_fp64.x * a_fp64.y) + a_fp64.y * a_fp64.y;
#endif
  return vec2(prod, err);
}

vec2 twoProd(float a, float b) {
  float prod = a * b;
  vec2 a_fp64 = split(a);
  vec2 b_fp64 = split(b);
  // twoProd is especially sensitive because mul_fp64 and div_fp64 both depend
  // on the split terms and cross terms staying in the original evaluation
  // order. If the compiler folds or reassociates them, the low part tends to
  // collapse to zero or NaN on some drivers.
  float highProduct = prevent_fp64_optimization(a_fp64.x * b_fp64.x);
  float crossProduct1 = prevent_fp64_optimization(a_fp64.x * b_fp64.y);
  float crossProduct2 = prevent_fp64_optimization(a_fp64.y * b_fp64.x);
  float lowProduct = prevent_fp64_optimization(a_fp64.y * b_fp64.y);
#if defined(LUMA_FP64_CODE_ELIMINATION_WORKAROUND)
  float err1 = (highProduct - prod) * fp64.ONE;
  float err2 = crossProduct1 * fp64.ONE * fp64.ONE;
  float err3 = crossProduct2 * fp64.ONE * fp64.ONE * fp64.ONE;
  float err4 = lowProduct * fp64.ONE * fp64.ONE * fp64.ONE * fp64.ONE;
#else
  float err1 = highProduct - prod;
  float err2 = crossProduct1;
  float err3 = crossProduct2;
  float err4 = lowProduct;
#endif
  float err = ((err1 + err2) + err3) + err4;
  return vec2(prod, err);
}

vec2 sum_fp64(vec2 a, vec2 b) {
  vec2 s, t;
  s = twoSum(a.x, b.x);
  t = twoSum(a.y, b.y);
  s.y += t.x;
  s = quickTwoSum(s.x, s.y);
  s.y += t.y;
  s = quickTwoSum(s.x, s.y);
  return s;
}

vec2 sub_fp64(vec2 a, vec2 b) {
  vec2 s, t;
  s = twoSub(a.x, b.x);
  t = twoSub(a.y, b.y);
  s.y += t.x;
  s = quickTwoSum(s.x, s.y);
  s.y += t.y;
  s = quickTwoSum(s.x, s.y);
  return s;
}

vec2 mul_fp64(vec2 a, vec2 b) {
  vec2 prod = twoProd(a.x, b.x);
  // y component is for the error
  prod.y += a.x * b.y;
#if defined(LUMA_FP64_HIGH_BITS_OVERFLOW_WORKAROUND)
  prod = split2(prod);
#endif
  prod = quickTwoSum(prod.x, prod.y);
  prod.y += a.y * b.x;
#if defined(LUMA_FP64_HIGH_BITS_OVERFLOW_WORKAROUND)
  prod = split2(prod);
#endif
  prod = quickTwoSum(prod.x, prod.y);
  return prod;
}

vec2 div_fp64(vec2 a, vec2 b) {
  float xn = 1.0 / b.x;
#if defined(LUMA_FP64_HIGH_BITS_OVERFLOW_WORKAROUND)
  vec2 yn = mul_fp64(a, vec2(xn, 0));
#else
  vec2 yn = a * xn;
#endif
  float diff = (sub_fp64(a, mul_fp64(b, yn))).x;
  vec2 prod = twoProd(xn, diff);
  return sum_fp64(yn, prod);
}

vec2 sqrt_fp64(vec2 a) {
  if (a.x == 0.0 && a.y == 0.0) return vec2(0.0, 0.0);
  if (a.x < 0.0) return vec2(0.0 / 0.0, 0.0 / 0.0);

  float x = 1.0 / sqrt(a.x);
  float yn = a.x * x;
#if defined(LUMA_FP64_CODE_ELIMINATION_WORKAROUND)
  vec2 yn_sqr = twoSqr(yn) * fp64.ONE;
#else
  vec2 yn_sqr = twoSqr(yn);
#endif
  float diff = sub_fp64(a, yn_sqr).x;
  vec2 prod = twoProd(x * 0.5, diff);
#if defined(LUMA_FP64_HIGH_BITS_OVERFLOW_WORKAROUND)
  return sum_fp64(split(yn), prod);
#else
  return sum_fp64(vec2(yn, 0.0), prod);
#endif
}
`;var Fs=`struct Fp64ArithmeticUniforms {
  ONE: f32,
  SPLIT: f32,
};

@group(0) @binding(auto) var<uniform> fp64arithmetic : Fp64ArithmeticUniforms;

fn fp64_nan(seed: f32) -> f32 {
  let nanBits = 0x7fc00000u | select(0u, 1u, seed < 0.0);
  return bitcast<f32>(nanBits);
}

fn fp64_runtime_zero() -> f32 {
  return fp64arithmetic.ONE * 0.0;
}

fn prevent_fp64_optimization(value: f32) -> f32 {
#ifdef LUMA_FP64_CODE_ELIMINATION_WORKAROUND
  return value + fp64_runtime_zero();
#else
  return value;
#endif
}

fn split(a: f32) -> vec2f {
  let splitValue = prevent_fp64_optimization(fp64arithmetic.SPLIT + fp64_runtime_zero());
  let t = prevent_fp64_optimization(a * splitValue);
  let temp = prevent_fp64_optimization(t - a);
  let aHi = prevent_fp64_optimization(t - temp);
  let aLo = prevent_fp64_optimization(a - aHi);
  return vec2f(aHi, aLo);
}

fn split2(a: vec2f) -> vec2f {
  var b = split(a.x);
  b.y = b.y + a.y;
  return b;
}

fn quickTwoSum(a: f32, b: f32) -> vec2f {
#ifdef LUMA_FP64_CODE_ELIMINATION_WORKAROUND
  let sum = prevent_fp64_optimization((a + b) * fp64arithmetic.ONE);
  let err = prevent_fp64_optimization(b - (sum - a) * fp64arithmetic.ONE);
#else
  let sum = prevent_fp64_optimization(a + b);
  let err = prevent_fp64_optimization(b - (sum - a));
#endif
  return vec2f(sum, err);
}

fn twoSum(a: f32, b: f32) -> vec2f {
  let s = prevent_fp64_optimization(a + b);
#ifdef LUMA_FP64_CODE_ELIMINATION_WORKAROUND
  let v = prevent_fp64_optimization((s * fp64arithmetic.ONE - a) * fp64arithmetic.ONE);
  let err =
    prevent_fp64_optimization((a - (s - v) * fp64arithmetic.ONE) *
      fp64arithmetic.ONE *
      fp64arithmetic.ONE *
      fp64arithmetic.ONE) +
    prevent_fp64_optimization(b - v);
#else
  let v = prevent_fp64_optimization(s - a);
  let err = prevent_fp64_optimization(a - (s - v)) + prevent_fp64_optimization(b - v);
#endif
  return vec2f(s, err);
}

fn twoSub(a: f32, b: f32) -> vec2f {
  let s = prevent_fp64_optimization(a - b);
#ifdef LUMA_FP64_CODE_ELIMINATION_WORKAROUND
  let v = prevent_fp64_optimization((s * fp64arithmetic.ONE - a) * fp64arithmetic.ONE);
  let err =
    prevent_fp64_optimization((a - (s - v) * fp64arithmetic.ONE) *
      fp64arithmetic.ONE *
      fp64arithmetic.ONE *
      fp64arithmetic.ONE) -
    prevent_fp64_optimization(b + v);
#else
  let v = prevent_fp64_optimization(s - a);
  let err = prevent_fp64_optimization(a - (s - v)) - prevent_fp64_optimization(b + v);
#endif
  return vec2f(s, err);
}

fn twoSqr(a: f32) -> vec2f {
  let prod = prevent_fp64_optimization(a * a);
  let aFp64 = split(a);
  let highProduct = prevent_fp64_optimization(aFp64.x * aFp64.x);
  let crossProduct = prevent_fp64_optimization(2.0 * aFp64.x * aFp64.y);
  let lowProduct = prevent_fp64_optimization(aFp64.y * aFp64.y);
#ifdef LUMA_FP64_CODE_ELIMINATION_WORKAROUND
  let err =
    (prevent_fp64_optimization(highProduct - prod) * fp64arithmetic.ONE +
      crossProduct * fp64arithmetic.ONE * fp64arithmetic.ONE) +
    lowProduct * fp64arithmetic.ONE * fp64arithmetic.ONE * fp64arithmetic.ONE;
#else
  let err = ((prevent_fp64_optimization(highProduct - prod) + crossProduct) + lowProduct);
#endif
  return vec2f(prod, err);
}

fn twoProd(a: f32, b: f32) -> vec2f {
  let prod = prevent_fp64_optimization(a * b);
  let aFp64 = split(a);
  let bFp64 = split(b);
  let highProduct = prevent_fp64_optimization(aFp64.x * bFp64.x);
  let crossProduct1 = prevent_fp64_optimization(aFp64.x * bFp64.y);
  let crossProduct2 = prevent_fp64_optimization(aFp64.y * bFp64.x);
  let lowProduct = prevent_fp64_optimization(aFp64.y * bFp64.y);
#ifdef LUMA_FP64_CODE_ELIMINATION_WORKAROUND
  let err1 = (highProduct - prod) * fp64arithmetic.ONE;
  let err2 = crossProduct1 * fp64arithmetic.ONE * fp64arithmetic.ONE;
  let err3 = crossProduct2 * fp64arithmetic.ONE * fp64arithmetic.ONE * fp64arithmetic.ONE;
  let err4 =
    lowProduct *
    fp64arithmetic.ONE *
    fp64arithmetic.ONE *
    fp64arithmetic.ONE *
    fp64arithmetic.ONE;
#else
  let err1 = highProduct - prod;
  let err2 = crossProduct1;
  let err3 = crossProduct2;
  let err4 = lowProduct;
#endif
  let err12InputA = prevent_fp64_optimization(err1);
  let err12InputB = prevent_fp64_optimization(err2);
  let err12 = prevent_fp64_optimization(err12InputA + err12InputB);
  let err123InputA = prevent_fp64_optimization(err12);
  let err123InputB = prevent_fp64_optimization(err3);
  let err123 = prevent_fp64_optimization(err123InputA + err123InputB);
  let err1234InputA = prevent_fp64_optimization(err123);
  let err1234InputB = prevent_fp64_optimization(err4);
  let err = prevent_fp64_optimization(err1234InputA + err1234InputB);
  return vec2f(prod, err);
}

fn sum_fp64(a: vec2f, b: vec2f) -> vec2f {
  var s = twoSum(a.x, b.x);
  let t = twoSum(a.y, b.y);
  s.y = prevent_fp64_optimization(s.y + t.x);
  s = quickTwoSum(s.x, s.y);
  s.y = prevent_fp64_optimization(s.y + t.y);
  s = quickTwoSum(s.x, s.y);
  return s;
}

fn sub_fp64(a: vec2f, b: vec2f) -> vec2f {
  var s = twoSub(a.x, b.x);
  let t = twoSub(a.y, b.y);
  s.y = prevent_fp64_optimization(s.y + t.x);
  s = quickTwoSum(s.x, s.y);
  s.y = prevent_fp64_optimization(s.y + t.y);
  s = quickTwoSum(s.x, s.y);
  return s;
}

fn mul_fp64(a: vec2f, b: vec2f) -> vec2f {
  var prod = twoProd(a.x, b.x);
  let crossProduct1 = prevent_fp64_optimization(a.x * b.y);
  prod.y = prevent_fp64_optimization(prod.y + crossProduct1);
#ifdef LUMA_FP64_HIGH_BITS_OVERFLOW_WORKAROUND
  prod = split2(prod);
#endif
  prod = quickTwoSum(prod.x, prod.y);
  let crossProduct2 = prevent_fp64_optimization(a.y * b.x);
  prod.y = prevent_fp64_optimization(prod.y + crossProduct2);
#ifdef LUMA_FP64_HIGH_BITS_OVERFLOW_WORKAROUND
  prod = split2(prod);
#endif
  prod = quickTwoSum(prod.x, prod.y);
  return prod;
}

fn div_fp64(a: vec2f, b: vec2f) -> vec2f {
  let xn = prevent_fp64_optimization(1.0 / b.x);
  let yn = mul_fp64(a, vec2f(xn, fp64_runtime_zero()));
  let diff = prevent_fp64_optimization(sub_fp64(a, mul_fp64(b, yn)).x);
  let prod = twoProd(xn, diff);
  return sum_fp64(yn, prod);
}

fn sqrt_fp64(a: vec2f) -> vec2f {
  if (a.x == 0.0 && a.y == 0.0) {
    return vec2f(0.0, 0.0);
  }
  if (a.x < 0.0) {
    let nanValue = fp64_nan(a.x);
    return vec2f(nanValue, nanValue);
  }

  let x = prevent_fp64_optimization(1.0 / sqrt(a.x));
  let yn = prevent_fp64_optimization(a.x * x);
#ifdef LUMA_FP64_CODE_ELIMINATION_WORKAROUND
  let ynSqr = twoSqr(yn) * fp64arithmetic.ONE;
#else
  let ynSqr = twoSqr(yn);
#endif
  let diff = prevent_fp64_optimization(sub_fp64(a, ynSqr).x);
  let prod = twoProd(prevent_fp64_optimization(x * 0.5), diff);
#ifdef LUMA_FP64_HIGH_BITS_OVERFLOW_WORKAROUND
  return sum_fp64(split(yn), prod);
#else
  return sum_fp64(vec2f(yn, 0.0), prod);
#endif
}
`;var sf={ONE:1,SPLIT:4097},Ro={name:"fp64arithmetic",source:Fs,fs:Lo,vs:Lo,defaultUniforms:sf,uniformTypes:{ONE:"f32",SPLIT:"f32"},fp64ify:To,fp64LowPart:Bs,fp64ifyMatrix4:Vs};var zs=`layout(std140) uniform floatColorsUniforms {
  float useByteColors;
} floatColors;

vec3 floatColors_normalize(vec3 inputColor) {
  return floatColors.useByteColors > 0.5 ? inputColor / 255.0 : inputColor;
}

vec4 floatColors_normalize(vec4 inputColor) {
  return floatColors.useByteColors > 0.5 ? inputColor / 255.0 : inputColor;
}

vec4 floatColors_premultiplyAlpha(vec4 inputColor) {
  return vec4(inputColor.rgb * inputColor.a, inputColor.a);
}

vec4 floatColors_unpremultiplyAlpha(vec4 inputColor) {
  return inputColor.a > 0.0 ? vec4(inputColor.rgb / inputColor.a, inputColor.a) : vec4(0.0);
}

vec4 floatColors_premultiply_alpha(vec4 inputColor) {
  return floatColors_premultiplyAlpha(inputColor);
}

vec4 floatColors_unpremultiply_alpha(vec4 inputColor) {
  return floatColors_unpremultiplyAlpha(inputColor);
}
`,af=`struct floatColorsUniforms {
  useByteColors: f32
};

@group(0) @binding(auto) var<uniform> floatColors : floatColorsUniforms;

fn floatColors_normalize(inputColor: vec3<f32>) -> vec3<f32> {
  return select(inputColor, inputColor / 255.0, floatColors.useByteColors > 0.5);
}

fn floatColors_normalize4(inputColor: vec4<f32>) -> vec4<f32> {
  return select(inputColor, inputColor / 255.0, floatColors.useByteColors > 0.5);
}

fn floatColors_premultiplyAlpha(inputColor: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(inputColor.rgb * inputColor.a, inputColor.a);
}

fn floatColors_unpremultiplyAlpha(inputColor: vec4<f32>) -> vec4<f32> {
  return select(
    vec4<f32>(0.0),
    vec4<f32>(inputColor.rgb / inputColor.a, inputColor.a),
    inputColor.a > 0.0
  );
}

fn floatColors_premultiply_alpha(inputColor: vec4<f32>) -> vec4<f32> {
  return floatColors_premultiplyAlpha(inputColor);
}

fn floatColors_unpremultiply_alpha(inputColor: vec4<f32>) -> vec4<f32> {
  return floatColors_unpremultiplyAlpha(inputColor);
}
`,nr={name:"floatColors",props:{},uniforms:{},vs:zs,fs:zs,source:af,uniformTypes:{useByteColors:"f32"},defaultUniforms:{useByteColors:!0}};var lf=[0,1,1,1],cf=`layout(std140) uniform pickingUniforms {
  float isActive;
  float isAttribute;
  float isHighlightActive;
  float useByteColors;
  vec3 highlightedObjectColor;
  vec4 highlightColor;
} picking;

out vec4 picking_vRGBcolor_Avalid;

// Normalize unsigned byte color to 0-1 range
vec3 picking_normalizeColor(vec3 color) {
  return picking.useByteColors > 0.5 ? color / 255.0 : color;
}

// Normalize unsigned byte color to 0-1 range
vec4 picking_normalizeColor(vec4 color) {
  return picking.useByteColors > 0.5 ? color / 255.0 : color;
}

bool picking_isColorZero(vec3 color) {
  return dot(color, vec3(1.0)) < 0.00001;
}

bool picking_isColorValid(vec3 color) {
  return dot(color, vec3(1.0)) > 0.00001;
}

// Check if this vertex is highlighted
bool isVertexHighlighted(vec3 vertexColor) {
  vec3 highlightedObjectColor = picking_normalizeColor(picking.highlightedObjectColor);
  return
    bool(picking.isHighlightActive) && picking_isColorZero(abs(vertexColor - highlightedObjectColor));
}

// Set the current picking color
void picking_setPickingColor(vec3 pickingColor) {
  pickingColor = picking_normalizeColor(pickingColor);

  if (bool(picking.isActive)) {
    // Use alpha as the validity flag. If pickingColor is [0, 0, 0] fragment is non-pickable
    picking_vRGBcolor_Avalid.a = float(picking_isColorValid(pickingColor));

    if (!bool(picking.isAttribute)) {
      // Stores the picking color so that the fragment shader can render it during picking
      picking_vRGBcolor_Avalid.rgb = pickingColor;
    }
  } else {
    // Do the comparison with selected item color in vertex shader as it should mean fewer compares
    picking_vRGBcolor_Avalid.a = float(isVertexHighlighted(pickingColor));
  }
}

void picking_setPickingAttribute(float value) {
  if (bool(picking.isAttribute)) {
    picking_vRGBcolor_Avalid.r = value;
  }
}

void picking_setPickingAttribute(vec2 value) {
  if (bool(picking.isAttribute)) {
    picking_vRGBcolor_Avalid.rg = value;
  }
}

void picking_setPickingAttribute(vec3 value) {
  if (bool(picking.isAttribute)) {
    picking_vRGBcolor_Avalid.rgb = value;
  }
}
`,ff=`layout(std140) uniform pickingUniforms {
  float isActive;
  float isAttribute;
  float isHighlightActive;
  float useByteColors;
  vec3 highlightedObjectColor;
  vec4 highlightColor;
} picking;

in vec4 picking_vRGBcolor_Avalid;

/*
 * Returns highlight color if this item is selected.
 */
vec4 picking_filterHighlightColor(vec4 color) {
  // If we are still picking, we don't highlight
  if (picking.isActive > 0.5) {
    return color;
  }

  bool selected = bool(picking_vRGBcolor_Avalid.a);

  if (selected) {
    // Blend in highlight color based on its alpha value
    float highLightAlpha = picking.highlightColor.a;
    float blendedAlpha = highLightAlpha + color.a * (1.0 - highLightAlpha);
    float highLightRatio = highLightAlpha / blendedAlpha;

    vec3 blendedRGB = mix(color.rgb, picking.highlightColor.rgb, highLightRatio);
    return vec4(blendedRGB, blendedAlpha);
  } else {
    return color;
  }
}

/*
 * Returns picking color if picking enabled else unmodified argument.
 */
vec4 picking_filterPickingColor(vec4 color) {
  if (bool(picking.isActive)) {
    if (picking_vRGBcolor_Avalid.a == 0.0) {
      discard;
    }
    return picking_vRGBcolor_Avalid;
  }
  return color;
}

/*
 * Returns picking color if picking is enabled if not
 * highlight color if this item is selected, otherwise unmodified argument.
 */
vec4 picking_filterColor(vec4 color) {
  vec4 highlightColor = picking_filterHighlightColor(color);
  return picking_filterPickingColor(highlightColor);
}
`,sr={props:{},uniforms:{},name:"picking",uniformTypes:{isActive:"f32",isAttribute:"f32",isHighlightActive:"f32",useByteColors:"f32",highlightedObjectColor:"vec3<f32>",highlightColor:"vec4<f32>"},defaultUniforms:{isActive:!1,isAttribute:!1,isHighlightActive:!1,useByteColors:!0,highlightedObjectColor:[0,0,0],highlightColor:lf},vs:cf,fs:ff,getUniforms:uf};function uf(r={},e){let t={},i=Gt(r.useByteColors,!0);if(r.highlightedObjectColor!==void 0)if(r.highlightedObjectColor===null)t.isHighlightActive=!1;else{t.isHighlightActive=!0;let o=r.highlightedObjectColor.slice(0,3);t.highlightedObjectColor=o}return r.highlightColor&&(t.highlightColor=Ao(r.highlightColor,i)),r.isActive!==void 0&&(t.isActive=!!r.isActive,t.isAttribute=!!r.isAttribute),r.useByteColors!==void 0&&(t.useByteColors=!!r.useByteColors),t}var Ht=20,hf=`
struct skinUniforms {
  jointMatrix: array<mat4x4<f32>, ${Ht}>,
};

@group(0) @binding(auto) var<uniform> skin: skinUniforms;

fn getSkinMatrix(weights: vec4f, joints: vec4u) -> mat4x4<f32> {
  return (weights.x * skin.jointMatrix[joints.x])
       + (weights.y * skin.jointMatrix[joints.y])
       + (weights.z * skin.jointMatrix[joints.z])
       + (weights.w * skin.jointMatrix[joints.w]);
}
`,pf=`
layout(std140) uniform skinUniforms {
  mat4 jointMatrix[SKIN_MAX_JOINTS];
} skin;

mat4 getSkinMatrix(vec4 weights, uvec4 joints) {
  return (weights.x * skin.jointMatrix[joints.x])
       + (weights.y * skin.jointMatrix[joints.y])
       + (weights.z * skin.jointMatrix[joints.z])
       + (weights.w * skin.jointMatrix[joints.w]);
}

`,df="",mf={props:{},uniforms:{},name:"skin",bindingLayout:[{name:"skin",group:0}],dependencies:[],source:hf,vs:pf,fs:df,defines:{SKIN_MAX_JOINTS:Ht},getUniforms:(r={},e)=>{let{scenegraphsFromGLTF:t}=r;if(!t?.gltf?.skins?.[0])return{jointMatrix:[]};let{inverseBindMatrices:i,joints:o,skeleton:n}=t.gltf.skins[0],s=[],a=i.value.length/16;for(let u=0;u<a;u++){let h=i.value.subarray(u*16,u*16+16);s.push(new O(Array.from(h)))}let l=t.gltfNodeIndexToNodeMap.get(n),c={};l.preorderTraversal((u,{worldMatrix:h})=>{c[u.id]=h});let f=new Float32Array(Ht*16);for(let u=0;u<Ht;++u){let h=o[u];if(h===void 0)break;let p=c[t.gltfNodeIndexToNodeMap.get(h).id],d=s[u],g=new O().copy(p).multiplyRight(d),b=u*16;for(let v=0;v<16;v++)f[b+v]=g[v]}return{jointMatrix:f}},uniformTypes:{jointMatrix:["mat4x4<f32>",Ht]}};var Io=`precision highp int;

// #if (defined(SHADER_TYPE_FRAGMENT) && defined(LIGHTING_FRAGMENT)) || (defined(SHADER_TYPE_VERTEX) && defined(LIGHTING_VERTEX))
struct AmbientLight {
  vec3 color;
};

struct PointLight {
  vec3 color;
  vec3 position;
  vec3 attenuation; // 2nd order x:Constant-y:Linear-z:Exponential
};

struct SpotLight {
  vec3 color;
  vec3 position;
  vec3 direction;
  vec3 attenuation;
  vec2 coneCos;
};

struct DirectionalLight {
  vec3 color;
  vec3 direction;
};

struct UniformLight {
  vec3 color;
  vec3 position;
  vec3 direction;
  vec3 attenuation;
  vec2 coneCos;
};

layout(std140) uniform lightingUniforms {
  int enabled;
  int directionalLightCount;
  int pointLightCount;
  int spotLightCount;
  vec3 ambientColor;
  UniformLight lights[5];
} lighting;

PointLight lighting_getPointLight(int index) {
  UniformLight light = lighting.lights[index];
  return PointLight(light.color, light.position, light.attenuation);
}

SpotLight lighting_getSpotLight(int index) {
  UniformLight light = lighting.lights[lighting.pointLightCount + index];
  return SpotLight(light.color, light.position, light.direction, light.attenuation, light.coneCos);
}

DirectionalLight lighting_getDirectionalLight(int index) {
  UniformLight light =
    lighting.lights[lighting.pointLightCount + lighting.spotLightCount + index];
  return DirectionalLight(light.color, light.direction);
}

float getPointLightAttenuation(PointLight pointLight, float distance) {
  return pointLight.attenuation.x
       + pointLight.attenuation.y * distance
       + pointLight.attenuation.z * distance * distance;
}

float getSpotLightAttenuation(SpotLight spotLight, vec3 positionWorldspace) {
  vec3 light_direction = normalize(positionWorldspace - spotLight.position);
  float coneFactor = smoothstep(
    spotLight.coneCos.y,
    spotLight.coneCos.x,
    dot(normalize(spotLight.direction), light_direction)
  );
  float distanceAttenuation = getPointLightAttenuation(
    PointLight(spotLight.color, spotLight.position, spotLight.attenuation),
    distance(spotLight.position, positionWorldspace)
  );
  return distanceAttenuation / max(coneFactor, 0.0001);
}

// #endif
`;var js=`// #if (defined(SHADER_TYPE_FRAGMENT) && defined(LIGHTING_FRAGMENT)) || (defined(SHADER_TYPE_VERTEX) && defined(LIGHTING_VERTEX))
const MAX_LIGHTS: i32 = 5;

struct AmbientLight {
  color: vec3<f32>,
};

struct PointLight {
  color: vec3<f32>,
  position: vec3<f32>,
  attenuation: vec3<f32>, // 2nd order x:Constant-y:Linear-z:Exponential
};

struct SpotLight {
  color: vec3<f32>,
  position: vec3<f32>,
  direction: vec3<f32>,
  attenuation: vec3<f32>,
  coneCos: vec2<f32>,
};

struct DirectionalLight {
  color: vec3<f32>,
  direction: vec3<f32>,
};

struct UniformLight {
  color: vec3<f32>,
  position: vec3<f32>,
  direction: vec3<f32>,
  attenuation: vec3<f32>,
  coneCos: vec2<f32>,
};

struct lightingUniforms {
  enabled: i32,
  directionalLightCount: i32,
  pointLightCount: i32,
  spotLightCount: i32,
  ambientColor: vec3<f32>,
  lights: array<UniformLight, 5>,
};

@group(2) @binding(auto) var<uniform> lighting : lightingUniforms;

fn lighting_getPointLight(index: i32) -> PointLight {
  let light = lighting.lights[index];
  return PointLight(light.color, light.position, light.attenuation);
}

fn lighting_getSpotLight(index: i32) -> SpotLight {
  let light = lighting.lights[lighting.pointLightCount + index];
  return SpotLight(light.color, light.position, light.direction, light.attenuation, light.coneCos);
}

fn lighting_getDirectionalLight(index: i32) -> DirectionalLight {
  let light = lighting.lights[lighting.pointLightCount + lighting.spotLightCount + index];
  return DirectionalLight(light.color, light.direction);
}

fn getPointLightAttenuation(pointLight: PointLight, distance: f32) -> f32 {
  return pointLight.attenuation.x
       + pointLight.attenuation.y * distance
       + pointLight.attenuation.z * distance * distance;
}

fn getSpotLightAttenuation(spotLight: SpotLight, positionWorldspace: vec3<f32>) -> f32 {
  let lightDirection = normalize(positionWorldspace - spotLight.position);
  let coneFactor = smoothstep(
    spotLight.coneCos.y,
    spotLight.coneCos.x,
    dot(normalize(spotLight.direction), lightDirection)
  );
  let distanceAttenuation = getPointLightAttenuation(
    PointLight(spotLight.color, spotLight.position, spotLight.attenuation),
    distance(spotLight.position, positionWorldspace)
  );
  return distanceAttenuation / max(coneFactor, 0.0001);
}
`;var je=5,gf={color:"vec3<f32>",position:"vec3<f32>",direction:"vec3<f32>",attenuation:"vec3<f32>",coneCos:"vec2<f32>"},ct={props:{},uniforms:{},name:"lighting",defines:{},uniformTypes:{enabled:"i32",directionalLightCount:"i32",pointLightCount:"i32",spotLightCount:"i32",ambientColor:"vec3<f32>",lights:[gf,je]},defaultUniforms:lr(),bindingLayout:[{name:"lighting",group:2}],firstBindingSlot:0,source:js,vs:Io,fs:Io,getUniforms:_f};function _f(r,e={}){if(r=r&&{...r},!r)return lr();r.lights&&(r={...r,...vf(r.lights),lights:void 0});let{useByteColors:t,ambientLight:i,pointLights:o,spotLights:n,directionalLights:s}=r||{};if(!(i||o&&o.length>0||n&&n.length>0||s&&s.length>0))return{...lr(),enabled:0};let l={...lr(),...bf({useByteColors:t,ambientLight:i,pointLights:o,spotLights:n,directionalLights:s})};return r.enabled!==void 0&&(l.enabled=r.enabled?1:0),l}function bf({useByteColors:r,ambientLight:e,pointLights:t=[],spotLights:i=[],directionalLights:o=[]}){let n=Gs(),s=0,a=0,l=0,c=0;for(let f of t){if(s>=je)break;n[s]={...n[s],color:ar(f,r),position:f.position,attenuation:f.attenuation||[1,0,0]},s++,a++}for(let f of i){if(s>=je)break;n[s]={...n[s],color:ar(f,r),position:f.position,direction:f.direction,attenuation:f.attenuation||[1,0,0],coneCos:Sf(f)},s++,l++}for(let f of o){if(s>=je)break;n[s]={...n[s],color:ar(f,r),direction:f.direction},s++,c++}return t.length+i.length+o.length>je&&L.warn(`MAX_LIGHTS exceeded, truncating to ${je}`)(),{ambientColor:ar(e,r),directionalLightCount:c,pointLightCount:a,spotLightCount:l,lights:n}}function vf(r){let e={pointLights:[],spotLights:[],directionalLights:[]};for(let t of r||[])switch(t.type){case"ambient":e.ambientLight=t;break;case"directional":e.directionalLights?.push(t);break;case"point":e.pointLights?.push(t);break;case"spot":e.spotLights?.push(t);break;default:}return e}function ar(r={},e){let{color:t=[0,0,0],intensity:i=1}=r;return or(t,Gt(e,!0)).map(n=>n*i)}function lr(){return{enabled:1,directionalLightCount:0,pointLightCount:0,spotLightCount:0,ambientColor:[.1,.1,.1],lights:Gs()}}function Gs(){return Array.from({length:je},()=>yf())}function yf(){return{color:[1,1,1],position:[1,1,2],direction:[1,1,1],attenuation:[1,0,0],coneCos:[1,0]}}function Sf(r){let e=r.innerConeAngle??0,t=r.outerConeAngle??Math.PI/4;return[Math.cos(e),Math.cos(t)]}var xf=`#ifdef USE_IBL
@group(2) @binding(auto) var pbr_diffuseEnvSampler: texture_cube<f32>;
@group(2) @binding(auto) var pbr_diffuseEnvSamplerSampler: sampler;
@group(2) @binding(auto) var pbr_specularEnvSampler: texture_cube<f32>;
@group(2) @binding(auto) var pbr_specularEnvSamplerSampler: sampler;
@group(2) @binding(auto) var pbr_brdfLUT: texture_2d<f32>;
@group(2) @binding(auto) var pbr_brdfLUTSampler: sampler;
#endif
`,Hs=`#ifdef USE_IBL
uniform samplerCube pbr_diffuseEnvSampler;
uniform samplerCube pbr_specularEnvSampler;
uniform sampler2D pbr_brdfLUT;
#endif
`,Ws={name:"ibl",firstBindingSlot:32,bindingLayout:[{name:"pbr_diffuseEnvSampler",group:2},{name:"pbr_specularEnvSampler",group:2},{name:"pbr_brdfLUT",group:2}],source:xf,vs:Hs,fs:Hs};var cr=`layout(std140) uniform phongMaterialUniforms {
  uniform bool unlit;
  uniform float ambient;
  uniform float diffuse;
  uniform float shininess;
  uniform vec3  specularColor;
} material;
`,fr=`layout(std140) uniform phongMaterialUniforms {
  uniform bool unlit;
  uniform float ambient;
  uniform float diffuse;
  uniform float shininess;
  uniform vec3  specularColor;
} material;

vec3 lighting_getLightColor(vec3 surfaceColor, vec3 light_direction, vec3 view_direction, vec3 normal_worldspace, vec3 color) {
  vec3 halfway_direction = normalize(light_direction + view_direction);
  float lambertian = dot(light_direction, normal_worldspace);
  float specular = 0.0;
  if (lambertian > 0.0) {
    float specular_angle = max(dot(normal_worldspace, halfway_direction), 0.0);
    specular = pow(specular_angle, material.shininess);
  }
  lambertian = max(lambertian, 0.0);
  return (lambertian * material.diffuse * surfaceColor + specular * floatColors_normalize(material.specularColor)) * color;
}

vec3 lighting_getLightColor(vec3 surfaceColor, vec3 cameraPosition, vec3 position_worldspace, vec3 normal_worldspace) {
  vec3 lightColor = surfaceColor;

  if (material.unlit) {
    return surfaceColor;
  }

  if (lighting.enabled == 0) {
    return lightColor;
  }

  vec3 view_direction = normalize(cameraPosition - position_worldspace);
  lightColor = material.ambient * surfaceColor * lighting.ambientColor;

  for (int i = 0; i < lighting.pointLightCount; i++) {
    PointLight pointLight = lighting_getPointLight(i);
    vec3 light_position_worldspace = pointLight.position;
    vec3 light_direction = normalize(light_position_worldspace - position_worldspace);
    float light_attenuation = getPointLightAttenuation(pointLight, distance(light_position_worldspace, position_worldspace));
    lightColor += lighting_getLightColor(surfaceColor, light_direction, view_direction, normal_worldspace, pointLight.color / light_attenuation);
  }

  for (int i = 0; i < lighting.spotLightCount; i++) {
    SpotLight spotLight = lighting_getSpotLight(i);
    vec3 light_position_worldspace = spotLight.position;
    vec3 light_direction = normalize(light_position_worldspace - position_worldspace);
    float light_attenuation = getSpotLightAttenuation(spotLight, position_worldspace);
    lightColor += lighting_getLightColor(surfaceColor, light_direction, view_direction, normal_worldspace, spotLight.color / light_attenuation);
  }

  for (int i = 0; i < lighting.directionalLightCount; i++) {
    DirectionalLight directionalLight = lighting_getDirectionalLight(i);
    lightColor += lighting_getLightColor(surfaceColor, -directionalLight.direction, view_direction, normal_worldspace, directionalLight.color);
  }

  return lightColor;
}
`;var ur=`struct phongMaterialUniforms {
  unlit: u32,
  ambient: f32,
  diffuse: f32,
  shininess: f32,
  specularColor: vec3<f32>,
};

@group(3) @binding(auto) var<uniform> phongMaterial : phongMaterialUniforms;

fn lighting_getLightColor(surfaceColor: vec3<f32>, light_direction: vec3<f32>, view_direction: vec3<f32>, normal_worldspace: vec3<f32>, color: vec3<f32>) -> vec3<f32> {
  let halfway_direction: vec3<f32> = normalize(light_direction + view_direction);
  var lambertian: f32 = dot(light_direction, normal_worldspace);
  var specular: f32 = 0.0;
  if (lambertian > 0.0) {
    let specular_angle = max(dot(normal_worldspace, halfway_direction), 0.0);
    specular = pow(specular_angle, phongMaterial.shininess);
  }
  lambertian = max(lambertian, 0.0);
  return (
    lambertian * phongMaterial.diffuse * surfaceColor +
    specular * floatColors_normalize(phongMaterial.specularColor)
  ) * color;
}

fn lighting_getLightColor2(surfaceColor: vec3<f32>, cameraPosition: vec3<f32>, position_worldspace: vec3<f32>, normal_worldspace: vec3<f32>) -> vec3<f32> {
  var lightColor: vec3<f32> = surfaceColor;

  if (phongMaterial.unlit != 0u) {
    return surfaceColor;
  }

  if (lighting.enabled == 0) {
    return lightColor;
  }

  let view_direction: vec3<f32> = normalize(cameraPosition - position_worldspace);
  lightColor = phongMaterial.ambient * surfaceColor * lighting.ambientColor;

  for (var i: i32 = 0; i < lighting.pointLightCount; i++) {
    let pointLight: PointLight = lighting_getPointLight(i);
    let light_position_worldspace: vec3<f32> = pointLight.position;
    let light_direction: vec3<f32> = normalize(light_position_worldspace - position_worldspace);
    let light_attenuation = getPointLightAttenuation(
      pointLight,
      distance(light_position_worldspace, position_worldspace)
    );
    lightColor += lighting_getLightColor(
      surfaceColor,
      light_direction,
      view_direction,
      normal_worldspace,
      pointLight.color / light_attenuation
    );
  }

  for (var i: i32 = 0; i < lighting.spotLightCount; i++) {
    let spotLight: SpotLight = lighting_getSpotLight(i);
    let light_position_worldspace: vec3<f32> = spotLight.position;
    let light_direction: vec3<f32> = normalize(light_position_worldspace - position_worldspace);
    let light_attenuation = getSpotLightAttenuation(spotLight, position_worldspace);
    lightColor += lighting_getLightColor(
      surfaceColor,
      light_direction,
      view_direction,
      normal_worldspace,
      spotLight.color / light_attenuation
    );
  }

  for (var i: i32 = 0; i < lighting.directionalLightCount; i++) {
    let directionalLight: DirectionalLight = lighting_getDirectionalLight(i);
    lightColor += lighting_getLightColor(surfaceColor, -directionalLight.direction, view_direction, normal_worldspace, directionalLight.color);
  }

  return lightColor;
}

fn lighting_getSpecularLightColor(cameraPosition: vec3<f32>, position_worldspace: vec3<f32>, normal_worldspace: vec3<f32>) -> vec3<f32>{
  var lightColor = vec3<f32>(0, 0, 0);
  let surfaceColor = vec3<f32>(0, 0, 0);

  if (lighting.enabled != 0) {
    let view_direction = normalize(cameraPosition - position_worldspace);

    for (var i: i32 = 0; i < lighting.pointLightCount; i++) {
      let pointLight: PointLight = lighting_getPointLight(i);
      let light_position_worldspace: vec3<f32> = pointLight.position;
      let light_direction: vec3<f32> = normalize(light_position_worldspace - position_worldspace);
      let light_attenuation = getPointLightAttenuation(
        pointLight,
        distance(light_position_worldspace, position_worldspace)
      );
      lightColor += lighting_getLightColor(
        surfaceColor,
        light_direction,
        view_direction,
        normal_worldspace,
        pointLight.color / light_attenuation
      );
    }

    for (var i: i32 = 0; i < lighting.spotLightCount; i++) {
      let spotLight: SpotLight = lighting_getSpotLight(i);
      let light_position_worldspace: vec3<f32> = spotLight.position;
      let light_direction: vec3<f32> = normalize(light_position_worldspace - position_worldspace);
      let light_attenuation = getSpotLightAttenuation(spotLight, position_worldspace);
      lightColor += lighting_getLightColor(
        surfaceColor,
        light_direction,
        view_direction,
        normal_worldspace,
        spotLight.color / light_attenuation
      );
    }

    for (var i: i32 = 0; i < lighting.directionalLightCount; i++) {
        let directionalLight: DirectionalLight = lighting_getDirectionalLight(i);
        lightColor += lighting_getLightColor(surfaceColor, -directionalLight.direction, view_direction, normal_worldspace, directionalLight.color);
    }
  }
  return lightColor;
}
`;var wf=[38.25,38.25,38.25],hr={props:{},name:"gouraudMaterial",bindingLayout:[{name:"gouraudMaterial",group:3}],vs:fr.replace("phongMaterial","gouraudMaterial"),fs:cr.replace("phongMaterial","gouraudMaterial"),source:ur.replaceAll("phongMaterial","gouraudMaterial"),defines:{LIGHTING_VERTEX:!0},dependencies:[ct,nr],uniformTypes:{unlit:"i32",ambient:"f32",diffuse:"f32",shininess:"f32",specularColor:"vec3<f32>"},defaultUniforms:{unlit:!1,ambient:.35,diffuse:.6,shininess:32,specularColor:wf},getUniforms(r){return{...hr.defaultUniforms,...r}}};var Ef=[38.25,38.25,38.25],pr={name:"phongMaterial",firstBindingSlot:0,bindingLayout:[{name:"phongMaterial",group:3}],dependencies:[ct,nr],source:ur,vs:cr,fs:fr,defines:{LIGHTING_FRAGMENT:!0},uniformTypes:{unlit:"i32",ambient:"f32",diffuse:"f32",shininess:"f32",specularColor:"vec3<f32>"},defaultUniforms:{unlit:!1,ambient:.35,diffuse:.6,shininess:32,specularColor:Ef},getUniforms(r){return{...pr.defaultUniforms,...r}}};var $s=`out vec3 pbr_vPosition;
out vec2 pbr_vUV0;
out vec2 pbr_vUV1;

#ifdef HAS_NORMALS
# ifdef HAS_TANGENTS
out mat3 pbr_vTBN;
# else
out vec3 pbr_vNormal;
# endif
#endif

void pbr_setPositionNormalTangentUV(
  vec4 position,
  vec4 normal,
  vec4 tangent,
  vec2 uv0,
  vec2 uv1
)
{
  vec4 pos = pbrProjection.modelMatrix * position;
  pbr_vPosition = vec3(pos.xyz) / pos.w;

#ifdef HAS_NORMALS
#ifdef HAS_TANGENTS
  vec3 normalW = normalize(vec3(pbrProjection.normalMatrix * vec4(normal.xyz, 0.0)));
  vec3 tangentW = normalize(vec3(pbrProjection.modelMatrix * vec4(tangent.xyz, 0.0)));
  vec3 bitangentW = cross(normalW, tangentW) * tangent.w;
  pbr_vTBN = mat3(tangentW, bitangentW, normalW);
#else // HAS_TANGENTS != 1
  pbr_vNormal = normalize(vec3(pbrProjection.modelMatrix * vec4(normal.xyz, 0.0)));
#endif
#endif

#ifdef HAS_UV
  pbr_vUV0 = uv0;
#else
  pbr_vUV0 = vec2(0.,0.);
#endif

  pbr_vUV1 = uv1;
}
`,Ys=`precision highp float;

layout(std140) uniform pbrMaterialUniforms {
  // Material is unlit
  bool unlit;

  // Base color map
  bool baseColorMapEnabled;
  vec4 baseColorFactor;

  bool normalMapEnabled;
  float normalScale; // #ifdef HAS_NORMALMAP

  bool emissiveMapEnabled;
  vec3 emissiveFactor; // #ifdef HAS_EMISSIVEMAP

  vec2 metallicRoughnessValues;
  bool metallicRoughnessMapEnabled;

  bool occlusionMapEnabled;
  float occlusionStrength; // #ifdef HAS_OCCLUSIONMAP

  bool alphaCutoffEnabled;
  float alphaCutoff; // #ifdef ALPHA_CUTOFF

  vec3 specularColorFactor;
  float specularIntensityFactor;
  bool specularColorMapEnabled;
  bool specularIntensityMapEnabled;

  float ior;

  float transmissionFactor;
  bool transmissionMapEnabled;

  float thicknessFactor;
  float attenuationDistance;
  vec3 attenuationColor;

  float clearcoatFactor;
  float clearcoatRoughnessFactor;
  bool clearcoatMapEnabled;
  bool clearcoatRoughnessMapEnabled;

  vec3 sheenColorFactor;
  float sheenRoughnessFactor;
  bool sheenColorMapEnabled;
  bool sheenRoughnessMapEnabled;

  float iridescenceFactor;
  float iridescenceIor;
  vec2 iridescenceThicknessRange;
  bool iridescenceMapEnabled;

  float anisotropyStrength;
  float anisotropyRotation;
  vec2 anisotropyDirection;
  bool anisotropyMapEnabled;

  float emissiveStrength;

  // IBL
  bool IBLenabled;
  vec2 scaleIBLAmbient; // #ifdef USE_IBL

  // debugging flags used for shader output of intermediate PBR variables
  // #ifdef PBR_DEBUG
  vec4 scaleDiffBaseMR;
  vec4 scaleFGDSpec;
  // #endif

  int baseColorUVSet;
  mat3 baseColorUVTransform;
  int metallicRoughnessUVSet;
  mat3 metallicRoughnessUVTransform;
  int normalUVSet;
  mat3 normalUVTransform;
  int occlusionUVSet;
  mat3 occlusionUVTransform;
  int emissiveUVSet;
  mat3 emissiveUVTransform;
  int specularColorUVSet;
  mat3 specularColorUVTransform;
  int specularIntensityUVSet;
  mat3 specularIntensityUVTransform;
  int transmissionUVSet;
  mat3 transmissionUVTransform;
  int thicknessUVSet;
  mat3 thicknessUVTransform;
  int clearcoatUVSet;
  mat3 clearcoatUVTransform;
  int clearcoatRoughnessUVSet;
  mat3 clearcoatRoughnessUVTransform;
  int clearcoatNormalUVSet;
  mat3 clearcoatNormalUVTransform;
  int sheenColorUVSet;
  mat3 sheenColorUVTransform;
  int sheenRoughnessUVSet;
  mat3 sheenRoughnessUVTransform;
  int iridescenceUVSet;
  mat3 iridescenceUVTransform;
  int iridescenceThicknessUVSet;
  mat3 iridescenceThicknessUVTransform;
  int anisotropyUVSet;
  mat3 anisotropyUVTransform;
} pbrMaterial;

// Samplers
#ifdef HAS_BASECOLORMAP
uniform sampler2D pbr_baseColorSampler;
#endif
#ifdef HAS_NORMALMAP
uniform sampler2D pbr_normalSampler;
#endif
#ifdef HAS_EMISSIVEMAP
uniform sampler2D pbr_emissiveSampler;
#endif
#ifdef HAS_METALROUGHNESSMAP
uniform sampler2D pbr_metallicRoughnessSampler;
#endif
#ifdef HAS_OCCLUSIONMAP
uniform sampler2D pbr_occlusionSampler;
#endif
#ifdef HAS_SPECULARCOLORMAP
uniform sampler2D pbr_specularColorSampler;
#endif
#ifdef HAS_SPECULARINTENSITYMAP
uniform sampler2D pbr_specularIntensitySampler;
#endif
#ifdef HAS_TRANSMISSIONMAP
uniform sampler2D pbr_transmissionSampler;
#endif
#ifdef HAS_THICKNESSMAP
uniform sampler2D pbr_thicknessSampler;
#endif
#ifdef HAS_CLEARCOATMAP
uniform sampler2D pbr_clearcoatSampler;
#endif
#ifdef HAS_CLEARCOATROUGHNESSMAP
uniform sampler2D pbr_clearcoatRoughnessSampler;
#endif
#ifdef HAS_CLEARCOATNORMALMAP
uniform sampler2D pbr_clearcoatNormalSampler;
#endif
#ifdef HAS_SHEENCOLORMAP
uniform sampler2D pbr_sheenColorSampler;
#endif
#ifdef HAS_SHEENROUGHNESSMAP
uniform sampler2D pbr_sheenRoughnessSampler;
#endif
#ifdef HAS_IRIDESCENCEMAP
uniform sampler2D pbr_iridescenceSampler;
#endif
#ifdef HAS_IRIDESCENCETHICKNESSMAP
uniform sampler2D pbr_iridescenceThicknessSampler;
#endif
#ifdef HAS_ANISOTROPYMAP
uniform sampler2D pbr_anisotropySampler;
#endif
// Inputs from vertex shader

in vec3 pbr_vPosition;
in vec2 pbr_vUV0;
in vec2 pbr_vUV1;

#ifdef HAS_NORMALS
#ifdef HAS_TANGENTS
in mat3 pbr_vTBN;
#else
in vec3 pbr_vNormal;
#endif
#endif

// Encapsulate the various inputs used by the various functions in the shading equation
// We store values in this struct to simplify the integration of alternative implementations
// of the shading terms, outlined in the Readme.MD Appendix.
struct PBRInfo {
  float NdotL;                  // cos angle between normal and light direction
  float NdotV;                  // cos angle between normal and view direction
  float NdotH;                  // cos angle between normal and half vector
  float LdotH;                  // cos angle between light direction and half vector
  float VdotH;                  // cos angle between view direction and half vector
  float perceptualRoughness;    // roughness value, as authored by the model creator (input to shader)
  float metalness;              // metallic value at the surface
  vec3 reflectance0;            // full reflectance color (normal incidence angle)
  vec3 reflectance90;           // reflectance color at grazing angle
  float alphaRoughness;         // roughness mapped to a more linear change in the roughness (proposed by [2])
  vec3 diffuseColor;            // color contribution from diffuse lighting
  vec3 specularColor;           // color contribution from specular lighting
  vec3 n;                       // normal at surface point
  vec3 v;                       // vector from surface point to camera
};

const float M_PI = 3.141592653589793;
const float c_MinRoughness = 0.04;

vec3 calculateFinalColor(PBRInfo pbrInfo, vec3 lightColor);

vec4 SRGBtoLINEAR(vec4 srgbIn)
{
#ifdef MANUAL_SRGB
#ifdef SRGB_FAST_APPROXIMATION
  vec3 linOut = pow(srgbIn.xyz,vec3(2.2));
#else // SRGB_FAST_APPROXIMATION
  vec3 bLess = step(vec3(0.04045),srgbIn.xyz);
  vec3 linOut = mix( srgbIn.xyz/vec3(12.92), pow((srgbIn.xyz+vec3(0.055))/vec3(1.055),vec3(2.4)), bLess );
#endif //SRGB_FAST_APPROXIMATION
  return vec4(linOut,srgbIn.w);;
#else //MANUAL_SRGB
  return srgbIn;
#endif //MANUAL_SRGB
}

vec2 getMaterialUV(int uvSet, mat3 uvTransform)
{
  vec2 baseUV = uvSet == 1 ? pbr_vUV1 : pbr_vUV0;
  return (uvTransform * vec3(baseUV, 1.0)).xy;
}

// Build the tangent basis from interpolated attributes or screen-space derivatives.
mat3 getTBN(vec2 uv)
{
#ifndef HAS_TANGENTS
  vec3 pos_dx = dFdx(pbr_vPosition);
  vec3 pos_dy = dFdy(pbr_vPosition);
  vec3 tex_dx = dFdx(vec3(uv, 0.0));
  vec3 tex_dy = dFdy(vec3(uv, 0.0));
  vec3 t = (tex_dy.t * pos_dx - tex_dx.t * pos_dy) / (tex_dx.s * tex_dy.t - tex_dy.s * tex_dx.t);

#ifdef HAS_NORMALS
  vec3 ng = normalize(pbr_vNormal);
#else
  vec3 ng = cross(pos_dx, pos_dy);
#endif

  t = normalize(t - ng * dot(ng, t));
  vec3 b = normalize(cross(ng, t));
  mat3 tbn = mat3(t, b, ng);
#else // HAS_TANGENTS
  mat3 tbn = pbr_vTBN;
#endif

  return tbn;
}

// Find the normal for this fragment, pulling either from a predefined normal map
// or from the interpolated mesh normal and tangent attributes.
vec3 getMappedNormal(sampler2D normalSampler, mat3 tbn, float normalScale, vec2 uv)
{
  vec3 n = texture(normalSampler, uv).rgb;
  return normalize(tbn * ((2.0 * n - 1.0) * vec3(normalScale, normalScale, 1.0)));
}

vec3 getNormal(mat3 tbn, vec2 uv)
{
#ifdef HAS_NORMALMAP
  vec3 n = getMappedNormal(pbr_normalSampler, tbn, pbrMaterial.normalScale, uv);
#else
  // The tbn matrix is linearly interpolated, so we need to re-normalize
  vec3 n = normalize(tbn[2].xyz);
#endif

  return n;
}

vec3 getClearcoatNormal(mat3 tbn, vec3 baseNormal, vec2 uv)
{
#ifdef HAS_CLEARCOATNORMALMAP
  return getMappedNormal(pbr_clearcoatNormalSampler, tbn, 1.0, uv);
#else
  return baseNormal;
#endif
}

// Calculation of the lighting contribution from an optional Image Based Light source.
// Precomputed Environment Maps are required uniform inputs and are computed as outlined in [1].
// See our README.md on Environment Maps [3] for additional discussion.
#ifdef USE_IBL
vec3 getIBLContribution(PBRInfo pbrInfo, vec3 n, vec3 reflection)
{
  float mipCount = 9.0; // resolution of 512x512
  float lod = (pbrInfo.perceptualRoughness * mipCount);
  // retrieve a scale and bias to F0. See [1], Figure 3
  vec3 brdf = SRGBtoLINEAR(texture(pbr_brdfLUT,
    vec2(pbrInfo.NdotV, 1.0 - pbrInfo.perceptualRoughness))).rgb;
  vec3 diffuseLight = SRGBtoLINEAR(texture(pbr_diffuseEnvSampler, n)).rgb;

#ifdef USE_TEX_LOD
  vec3 specularLight = SRGBtoLINEAR(texture(pbr_specularEnvSampler, reflection, lod)).rgb;
#else
  vec3 specularLight = SRGBtoLINEAR(texture(pbr_specularEnvSampler, reflection)).rgb;
#endif

  vec3 diffuse = diffuseLight * pbrInfo.diffuseColor;
  vec3 specular = specularLight * (pbrInfo.specularColor * brdf.x + brdf.y);

  // For presentation, this allows us to disable IBL terms
  diffuse *= pbrMaterial.scaleIBLAmbient.x;
  specular *= pbrMaterial.scaleIBLAmbient.y;

  return diffuse + specular;
}
#endif

// Basic Lambertian diffuse
// Implementation from Lambert's Photometria https://archive.org/details/lambertsphotome00lambgoog
// See also [1], Equation 1
vec3 diffuse(PBRInfo pbrInfo)
{
  return pbrInfo.diffuseColor / M_PI;
}

// The following equation models the Fresnel reflectance term of the spec equation (aka F())
// Implementation of fresnel from [4], Equation 15
vec3 specularReflection(PBRInfo pbrInfo)
{
  return pbrInfo.reflectance0 +
    (pbrInfo.reflectance90 - pbrInfo.reflectance0) *
    pow(clamp(1.0 - pbrInfo.VdotH, 0.0, 1.0), 5.0);
}

// This calculates the specular geometric attenuation (aka G()),
// where rougher material will reflect less light back to the viewer.
// This implementation is based on [1] Equation 4, and we adopt their modifications to
// alphaRoughness as input as originally proposed in [2].
float geometricOcclusion(PBRInfo pbrInfo)
{
  float NdotL = pbrInfo.NdotL;
  float NdotV = pbrInfo.NdotV;
  float r = pbrInfo.alphaRoughness;

  float attenuationL = 2.0 * NdotL / (NdotL + sqrt(r * r + (1.0 - r * r) * (NdotL * NdotL)));
  float attenuationV = 2.0 * NdotV / (NdotV + sqrt(r * r + (1.0 - r * r) * (NdotV * NdotV)));
  return attenuationL * attenuationV;
}

// The following equation(s) model the distribution of microfacet normals across
// the area being drawn (aka D())
// Implementation from "Average Irregularity Representation of a Roughened Surface
// for Ray Reflection" by T. S. Trowbridge, and K. P. Reitz
// Follows the distribution function recommended in the SIGGRAPH 2013 course notes
// from EPIC Games [1], Equation 3.
float microfacetDistribution(PBRInfo pbrInfo)
{
  float roughnessSq = pbrInfo.alphaRoughness * pbrInfo.alphaRoughness;
  float f = (pbrInfo.NdotH * roughnessSq - pbrInfo.NdotH) * pbrInfo.NdotH + 1.0;
  return roughnessSq / (M_PI * f * f);
}

float maxComponent(vec3 value)
{
  return max(max(value.r, value.g), value.b);
}

float getDielectricF0(float ior)
{
  float clampedIor = max(ior, 1.0);
  float ratio = (clampedIor - 1.0) / (clampedIor + 1.0);
  return ratio * ratio;
}

vec2 normalizeDirection(vec2 direction)
{
  float directionLength = length(direction);
  return directionLength > 0.0001 ? direction / directionLength : vec2(1.0, 0.0);
}

vec2 rotateDirection(vec2 direction, float rotation)
{
  float s = sin(rotation);
  float c = cos(rotation);
  return vec2(direction.x * c - direction.y * s, direction.x * s + direction.y * c);
}

vec3 getIridescenceTint(float iridescence, float thickness, float NdotV)
{
  if (iridescence <= 0.0) {
    return vec3(1.0);
  }

  float phase = 0.015 * thickness * pbrMaterial.iridescenceIor + (1.0 - NdotV) * 6.0;
  vec3 thinFilmTint =
    0.5 + 0.5 * cos(vec3(phase, phase + 2.0943951, phase + 4.1887902));
  return mix(vec3(1.0), thinFilmTint, iridescence);
}

vec3 getVolumeAttenuation(float thickness)
{
  if (thickness <= 0.0) {
    return vec3(1.0);
  }

  vec3 attenuationCoefficient =
    -log(max(pbrMaterial.attenuationColor, vec3(0.0001))) /
    max(pbrMaterial.attenuationDistance, 0.0001);
  return exp(-attenuationCoefficient * thickness);
}

PBRInfo createClearcoatPBRInfo(PBRInfo basePBRInfo, vec3 clearcoatNormal, float clearcoatRoughness)
{
  float perceptualRoughness = clamp(clearcoatRoughness, c_MinRoughness, 1.0);
  float alphaRoughness = perceptualRoughness * perceptualRoughness;
  float NdotV = clamp(abs(dot(clearcoatNormal, basePBRInfo.v)), 0.001, 1.0);

  return PBRInfo(
    basePBRInfo.NdotL,
    NdotV,
    basePBRInfo.NdotH,
    basePBRInfo.LdotH,
    basePBRInfo.VdotH,
    perceptualRoughness,
    0.0,
    vec3(0.04),
    vec3(1.0),
    alphaRoughness,
    vec3(0.0),
    vec3(0.04),
    clearcoatNormal,
    basePBRInfo.v
  );
}

vec3 calculateClearcoatContribution(
  PBRInfo pbrInfo,
  vec3 lightColor,
  vec3 clearcoatNormal,
  float clearcoatFactor,
  float clearcoatRoughness
) {
  if (clearcoatFactor <= 0.0) {
    return vec3(0.0);
  }

  PBRInfo clearcoatPBRInfo = createClearcoatPBRInfo(pbrInfo, clearcoatNormal, clearcoatRoughness);
  return calculateFinalColor(clearcoatPBRInfo, lightColor) * clearcoatFactor;
}

#ifdef USE_IBL
vec3 calculateClearcoatIBLContribution(
  PBRInfo pbrInfo,
  vec3 clearcoatNormal,
  vec3 reflection,
  float clearcoatFactor,
  float clearcoatRoughness
) {
  if (clearcoatFactor <= 0.0) {
    return vec3(0.0);
  }

  PBRInfo clearcoatPBRInfo = createClearcoatPBRInfo(pbrInfo, clearcoatNormal, clearcoatRoughness);
  return getIBLContribution(clearcoatPBRInfo, clearcoatNormal, reflection) * clearcoatFactor;
}
#endif

vec3 calculateSheenContribution(
  PBRInfo pbrInfo,
  vec3 lightColor,
  vec3 sheenColor,
  float sheenRoughness
) {
  if (maxComponent(sheenColor) <= 0.0) {
    return vec3(0.0);
  }

  float sheenFresnel = pow(clamp(1.0 - pbrInfo.VdotH, 0.0, 1.0), 5.0);
  float sheenVisibility = mix(1.0, pbrInfo.NdotL * pbrInfo.NdotV, sheenRoughness);
  return pbrInfo.NdotL *
    lightColor *
    sheenColor *
    (0.25 + 0.75 * sheenFresnel) *
    sheenVisibility *
    (1.0 - pbrInfo.metalness);
}

float calculateAnisotropyBoost(
  PBRInfo pbrInfo,
  vec3 anisotropyTangent,
  float anisotropyStrength
) {
  if (anisotropyStrength <= 0.0) {
    return 1.0;
  }

  vec3 anisotropyBitangent = normalize(cross(pbrInfo.n, anisotropyTangent));
  float bitangentViewAlignment = abs(dot(pbrInfo.v, anisotropyBitangent));
  return mix(1.0, 0.65 + 0.7 * bitangentViewAlignment, anisotropyStrength);
}

vec3 calculateMaterialLightColor(
  PBRInfo pbrInfo,
  vec3 lightColor,
  vec3 clearcoatNormal,
  float clearcoatFactor,
  float clearcoatRoughness,
  vec3 sheenColor,
  float sheenRoughness,
  vec3 anisotropyTangent,
  float anisotropyStrength
) {
  float anisotropyBoost = calculateAnisotropyBoost(pbrInfo, anisotropyTangent, anisotropyStrength);
  vec3 color = calculateFinalColor(pbrInfo, lightColor) * anisotropyBoost;
  color += calculateClearcoatContribution(
    pbrInfo,
    lightColor,
    clearcoatNormal,
    clearcoatFactor,
    clearcoatRoughness
  );
  color += calculateSheenContribution(pbrInfo, lightColor, sheenColor, sheenRoughness);
  return color;
}

void PBRInfo_setAmbientLight(inout PBRInfo pbrInfo) {
  pbrInfo.NdotL = 1.0;
  pbrInfo.NdotH = 0.0;
  pbrInfo.LdotH = 0.0;
  pbrInfo.VdotH = 1.0;
}

void PBRInfo_setDirectionalLight(inout PBRInfo pbrInfo, vec3 lightDirection) {
  vec3 n = pbrInfo.n;
  vec3 v = pbrInfo.v;
  vec3 l = normalize(lightDirection);             // Vector from surface point to light
  vec3 h = normalize(l+v);                        // Half vector between both l and v

  pbrInfo.NdotL = clamp(dot(n, l), 0.001, 1.0);
  pbrInfo.NdotH = clamp(dot(n, h), 0.0, 1.0);
  pbrInfo.LdotH = clamp(dot(l, h), 0.0, 1.0);
  pbrInfo.VdotH = clamp(dot(v, h), 0.0, 1.0);
}

void PBRInfo_setPointLight(inout PBRInfo pbrInfo, PointLight pointLight) {
  vec3 light_direction = normalize(pointLight.position - pbr_vPosition);
  PBRInfo_setDirectionalLight(pbrInfo, light_direction);
}

void PBRInfo_setSpotLight(inout PBRInfo pbrInfo, SpotLight spotLight) {
  vec3 light_direction = normalize(spotLight.position - pbr_vPosition);
  PBRInfo_setDirectionalLight(pbrInfo, light_direction);
}

vec3 calculateFinalColor(PBRInfo pbrInfo, vec3 lightColor) {
  // Calculate the shading terms for the microfacet specular shading model
  vec3 F = specularReflection(pbrInfo);
  float G = geometricOcclusion(pbrInfo);
  float D = microfacetDistribution(pbrInfo);

  // Calculation of analytical lighting contribution
  vec3 diffuseContrib = (1.0 - F) * diffuse(pbrInfo);
  vec3 specContrib = F * G * D / (4.0 * pbrInfo.NdotL * pbrInfo.NdotV);
  // Obtain final intensity as reflectance (BRDF) scaled by the energy of the light (cosine law)
  return pbrInfo.NdotL * lightColor * (diffuseContrib + specContrib);
}

vec4 pbr_filterColor(vec4 colorUnused)
{
  vec2 baseColorUV = getMaterialUV(pbrMaterial.baseColorUVSet, pbrMaterial.baseColorUVTransform);
  vec2 metallicRoughnessUV = getMaterialUV(
    pbrMaterial.metallicRoughnessUVSet,
    pbrMaterial.metallicRoughnessUVTransform
  );
  vec2 normalUV = getMaterialUV(pbrMaterial.normalUVSet, pbrMaterial.normalUVTransform);
  vec2 occlusionUV = getMaterialUV(pbrMaterial.occlusionUVSet, pbrMaterial.occlusionUVTransform);
  vec2 emissiveUV = getMaterialUV(pbrMaterial.emissiveUVSet, pbrMaterial.emissiveUVTransform);
  vec2 specularColorUV = getMaterialUV(
    pbrMaterial.specularColorUVSet,
    pbrMaterial.specularColorUVTransform
  );
  vec2 specularIntensityUV = getMaterialUV(
    pbrMaterial.specularIntensityUVSet,
    pbrMaterial.specularIntensityUVTransform
  );
  vec2 transmissionUV = getMaterialUV(
    pbrMaterial.transmissionUVSet,
    pbrMaterial.transmissionUVTransform
  );
  vec2 thicknessUV = getMaterialUV(pbrMaterial.thicknessUVSet, pbrMaterial.thicknessUVTransform);
  vec2 clearcoatUV = getMaterialUV(pbrMaterial.clearcoatUVSet, pbrMaterial.clearcoatUVTransform);
  vec2 clearcoatRoughnessUV = getMaterialUV(
    pbrMaterial.clearcoatRoughnessUVSet,
    pbrMaterial.clearcoatRoughnessUVTransform
  );
  vec2 clearcoatNormalUV = getMaterialUV(
    pbrMaterial.clearcoatNormalUVSet,
    pbrMaterial.clearcoatNormalUVTransform
  );
  vec2 sheenColorUV = getMaterialUV(
    pbrMaterial.sheenColorUVSet,
    pbrMaterial.sheenColorUVTransform
  );
  vec2 sheenRoughnessUV = getMaterialUV(
    pbrMaterial.sheenRoughnessUVSet,
    pbrMaterial.sheenRoughnessUVTransform
  );
  vec2 iridescenceUV = getMaterialUV(
    pbrMaterial.iridescenceUVSet,
    pbrMaterial.iridescenceUVTransform
  );
  vec2 iridescenceThicknessUV = getMaterialUV(
    pbrMaterial.iridescenceThicknessUVSet,
    pbrMaterial.iridescenceThicknessUVTransform
  );
  vec2 anisotropyUV = getMaterialUV(
    pbrMaterial.anisotropyUVSet,
    pbrMaterial.anisotropyUVTransform
  );

  // The albedo may be defined from a base texture or a flat color
#ifdef HAS_BASECOLORMAP
  vec4 baseColor =
    SRGBtoLINEAR(texture(pbr_baseColorSampler, baseColorUV)) * pbrMaterial.baseColorFactor;
#else
  vec4 baseColor = pbrMaterial.baseColorFactor;
#endif

#ifdef ALPHA_CUTOFF
  if (baseColor.a < pbrMaterial.alphaCutoff) {
    discard;
  }
#endif

  vec3 color = vec3(0, 0, 0);

  float transmission = 0.0;

  if(pbrMaterial.unlit){
    color.rgb = baseColor.rgb;
  }
  else{
    // Metallic and Roughness material properties are packed together
    // In glTF, these factors can be specified by fixed scalar values
    // or from a metallic-roughness map
    float perceptualRoughness = pbrMaterial.metallicRoughnessValues.y;
    float metallic = pbrMaterial.metallicRoughnessValues.x;
#ifdef HAS_METALROUGHNESSMAP
    // Roughness is stored in the 'g' channel, metallic is stored in the 'b' channel.
    // This layout intentionally reserves the 'r' channel for (optional) occlusion map data
    vec4 mrSample = texture(pbr_metallicRoughnessSampler, metallicRoughnessUV);
    perceptualRoughness = mrSample.g * perceptualRoughness;
    metallic = mrSample.b * metallic;
#endif
    perceptualRoughness = clamp(perceptualRoughness, c_MinRoughness, 1.0);
    metallic = clamp(metallic, 0.0, 1.0);
    mat3 tbn = getTBN(normalUV);
    vec3 n = getNormal(tbn, normalUV);                          // normal at surface point
    vec3 v = normalize(pbrProjection.camera - pbr_vPosition);  // Vector from surface point to camera
    float NdotV = clamp(abs(dot(n, v)), 0.001, 1.0);
#ifdef USE_MATERIAL_EXTENSIONS
    bool useExtendedPBR =
      pbrMaterial.specularColorMapEnabled ||
      pbrMaterial.specularIntensityMapEnabled ||
      abs(pbrMaterial.specularIntensityFactor - 1.0) > 0.0001 ||
      maxComponent(abs(pbrMaterial.specularColorFactor - vec3(1.0))) > 0.0001 ||
      abs(pbrMaterial.ior - 1.5) > 0.0001 ||
      pbrMaterial.transmissionMapEnabled ||
      pbrMaterial.transmissionFactor > 0.0001 ||
      pbrMaterial.clearcoatMapEnabled ||
      pbrMaterial.clearcoatRoughnessMapEnabled ||
      pbrMaterial.clearcoatFactor > 0.0001 ||
      pbrMaterial.clearcoatRoughnessFactor > 0.0001 ||
      pbrMaterial.sheenColorMapEnabled ||
      pbrMaterial.sheenRoughnessMapEnabled ||
      maxComponent(pbrMaterial.sheenColorFactor) > 0.0001 ||
      pbrMaterial.sheenRoughnessFactor > 0.0001 ||
      pbrMaterial.iridescenceMapEnabled ||
      pbrMaterial.iridescenceFactor > 0.0001 ||
      abs(pbrMaterial.iridescenceIor - 1.3) > 0.0001 ||
      abs(pbrMaterial.iridescenceThicknessRange.x - 100.0) > 0.0001 ||
      abs(pbrMaterial.iridescenceThicknessRange.y - 400.0) > 0.0001 ||
      pbrMaterial.anisotropyMapEnabled ||
      pbrMaterial.anisotropyStrength > 0.0001 ||
      abs(pbrMaterial.anisotropyRotation) > 0.0001 ||
      length(pbrMaterial.anisotropyDirection - vec2(1.0, 0.0)) > 0.0001;
#else
    bool useExtendedPBR = false;
#endif

    if (!useExtendedPBR) {
      // Keep the baseline metallic-roughness implementation byte-for-byte equivalent in behavior.
      float alphaRoughness = perceptualRoughness * perceptualRoughness;

      vec3 f0 = vec3(0.04);
      vec3 diffuseColor = baseColor.rgb * (vec3(1.0) - f0);
      diffuseColor *= 1.0 - metallic;
      vec3 specularColor = mix(f0, baseColor.rgb, metallic);

      float reflectance = max(max(specularColor.r, specularColor.g), specularColor.b);
      float reflectance90 = clamp(reflectance * 25.0, 0.0, 1.0);
      vec3 specularEnvironmentR0 = specularColor.rgb;
      vec3 specularEnvironmentR90 = vec3(1.0, 1.0, 1.0) * reflectance90;
      vec3 reflection = -normalize(reflect(v, n));

      PBRInfo pbrInfo = PBRInfo(
        0.0, // NdotL
        NdotV,
        0.0, // NdotH
        0.0, // LdotH
        0.0, // VdotH
        perceptualRoughness,
        metallic,
        specularEnvironmentR0,
        specularEnvironmentR90,
        alphaRoughness,
        diffuseColor,
        specularColor,
        n,
        v
      );

#ifdef USE_LIGHTS
      PBRInfo_setAmbientLight(pbrInfo);
      color += calculateFinalColor(pbrInfo, lighting.ambientColor);

      for(int i = 0; i < lighting.directionalLightCount; i++) {
        if (i < lighting.directionalLightCount) {
          PBRInfo_setDirectionalLight(pbrInfo, lighting_getDirectionalLight(i).direction);
          color += calculateFinalColor(pbrInfo, lighting_getDirectionalLight(i).color);
        }
      }

      for(int i = 0; i < lighting.pointLightCount; i++) {
        if (i < lighting.pointLightCount) {
          PBRInfo_setPointLight(pbrInfo, lighting_getPointLight(i));
          float attenuation = getPointLightAttenuation(lighting_getPointLight(i), distance(lighting_getPointLight(i).position, pbr_vPosition));
          color += calculateFinalColor(pbrInfo, lighting_getPointLight(i).color / attenuation);
        }
      }

      for(int i = 0; i < lighting.spotLightCount; i++) {
        if (i < lighting.spotLightCount) {
          PBRInfo_setSpotLight(pbrInfo, lighting_getSpotLight(i));
          float attenuation = getSpotLightAttenuation(lighting_getSpotLight(i), pbr_vPosition);
          color += calculateFinalColor(pbrInfo, lighting_getSpotLight(i).color / attenuation);
        }
      }
#endif

#ifdef USE_IBL
      if (pbrMaterial.IBLenabled) {
        color += getIBLContribution(pbrInfo, n, reflection);
      }
#endif

#ifdef HAS_OCCLUSIONMAP
      if (pbrMaterial.occlusionMapEnabled) {
        float ao = texture(pbr_occlusionSampler, occlusionUV).r;
        color = mix(color, color * ao, pbrMaterial.occlusionStrength);
      }
#endif

      vec3 emissive = pbrMaterial.emissiveFactor;
#ifdef HAS_EMISSIVEMAP
      if (pbrMaterial.emissiveMapEnabled) {
        emissive *= SRGBtoLINEAR(texture(pbr_emissiveSampler, emissiveUV)).rgb;
      }
#endif
      color += emissive * pbrMaterial.emissiveStrength;

#ifdef PBR_DEBUG
      color = mix(color, baseColor.rgb, pbrMaterial.scaleDiffBaseMR.y);
      color = mix(color, vec3(metallic), pbrMaterial.scaleDiffBaseMR.z);
      color = mix(color, vec3(perceptualRoughness), pbrMaterial.scaleDiffBaseMR.w);
#endif

      return vec4(pow(color, vec3(1.0 / 2.2)), baseColor.a);
    }

    float specularIntensity = pbrMaterial.specularIntensityFactor;
#ifdef HAS_SPECULARINTENSITYMAP
    if (pbrMaterial.specularIntensityMapEnabled) {
      specularIntensity *= texture(pbr_specularIntensitySampler, specularIntensityUV).a;
    }
#endif

    vec3 specularFactor = pbrMaterial.specularColorFactor;
#ifdef HAS_SPECULARCOLORMAP
    if (pbrMaterial.specularColorMapEnabled) {
      specularFactor *= SRGBtoLINEAR(texture(pbr_specularColorSampler, specularColorUV)).rgb;
    }
#endif

    transmission = pbrMaterial.transmissionFactor;
#ifdef HAS_TRANSMISSIONMAP
    if (pbrMaterial.transmissionMapEnabled) {
      transmission *= texture(pbr_transmissionSampler, transmissionUV).r;
    }
#endif
    transmission = clamp(transmission * (1.0 - metallic), 0.0, 1.0);
    float thickness = max(pbrMaterial.thicknessFactor, 0.0);
#ifdef HAS_THICKNESSMAP
    thickness *= texture(pbr_thicknessSampler, thicknessUV).g;
#endif

    float clearcoatFactor = pbrMaterial.clearcoatFactor;
    float clearcoatRoughness = pbrMaterial.clearcoatRoughnessFactor;
#ifdef HAS_CLEARCOATMAP
    if (pbrMaterial.clearcoatMapEnabled) {
      clearcoatFactor *= texture(pbr_clearcoatSampler, clearcoatUV).r;
    }
#endif
#ifdef HAS_CLEARCOATROUGHNESSMAP
    if (pbrMaterial.clearcoatRoughnessMapEnabled) {
      clearcoatRoughness *= texture(pbr_clearcoatRoughnessSampler, clearcoatRoughnessUV).g;
    }
#endif
    clearcoatFactor = clamp(clearcoatFactor, 0.0, 1.0);
    clearcoatRoughness = clamp(clearcoatRoughness, c_MinRoughness, 1.0);
    vec3 clearcoatNormal = getClearcoatNormal(getTBN(clearcoatNormalUV), n, clearcoatNormalUV);

    vec3 sheenColor = pbrMaterial.sheenColorFactor;
    float sheenRoughness = pbrMaterial.sheenRoughnessFactor;
#ifdef HAS_SHEENCOLORMAP
    if (pbrMaterial.sheenColorMapEnabled) {
      sheenColor *= SRGBtoLINEAR(texture(pbr_sheenColorSampler, sheenColorUV)).rgb;
    }
#endif
#ifdef HAS_SHEENROUGHNESSMAP
    if (pbrMaterial.sheenRoughnessMapEnabled) {
      sheenRoughness *= texture(pbr_sheenRoughnessSampler, sheenRoughnessUV).a;
    }
#endif
    sheenRoughness = clamp(sheenRoughness, c_MinRoughness, 1.0);

    float iridescence = pbrMaterial.iridescenceFactor;
#ifdef HAS_IRIDESCENCEMAP
    if (pbrMaterial.iridescenceMapEnabled) {
      iridescence *= texture(pbr_iridescenceSampler, iridescenceUV).r;
    }
#endif
    iridescence = clamp(iridescence, 0.0, 1.0);
    float iridescenceThickness = mix(
      pbrMaterial.iridescenceThicknessRange.x,
      pbrMaterial.iridescenceThicknessRange.y,
      0.5
    );
#ifdef HAS_IRIDESCENCETHICKNESSMAP
    iridescenceThickness = mix(
      pbrMaterial.iridescenceThicknessRange.x,
      pbrMaterial.iridescenceThicknessRange.y,
      texture(pbr_iridescenceThicknessSampler, iridescenceThicknessUV).g
    );
#endif

    float anisotropyStrength = clamp(pbrMaterial.anisotropyStrength, 0.0, 1.0);
    vec2 anisotropyDirection = normalizeDirection(pbrMaterial.anisotropyDirection);
#ifdef HAS_ANISOTROPYMAP
    if (pbrMaterial.anisotropyMapEnabled) {
      vec3 anisotropySample = texture(pbr_anisotropySampler, anisotropyUV).rgb;
      anisotropyStrength *= anisotropySample.b;
      vec2 mappedDirection = anisotropySample.rg * 2.0 - 1.0;
      if (length(mappedDirection) > 0.0001) {
        anisotropyDirection = normalize(mappedDirection);
      }
    }
#endif
    anisotropyDirection = rotateDirection(anisotropyDirection, pbrMaterial.anisotropyRotation);
    vec3 anisotropyTangent = normalize(tbn[0] * anisotropyDirection.x + tbn[1] * anisotropyDirection.y);
    if (length(anisotropyTangent) < 0.0001) {
      anisotropyTangent = normalize(tbn[0]);
    }
    float anisotropyViewAlignment = abs(dot(v, anisotropyTangent));
    perceptualRoughness = mix(
      perceptualRoughness,
      clamp(perceptualRoughness * (1.0 - 0.6 * anisotropyViewAlignment), c_MinRoughness, 1.0),
      anisotropyStrength
    );

    // Roughness is authored as perceptual roughness; as is convention,
    // convert to material roughness by squaring the perceptual roughness [2].
    float alphaRoughness = perceptualRoughness * perceptualRoughness;

    float dielectricF0 = getDielectricF0(pbrMaterial.ior);
    vec3 dielectricSpecularF0 = min(
      vec3(dielectricF0) * specularFactor * specularIntensity,
      vec3(1.0)
    );
    vec3 iridescenceTint = getIridescenceTint(iridescence, iridescenceThickness, NdotV);
    dielectricSpecularF0 = mix(
      dielectricSpecularF0,
      dielectricSpecularF0 * iridescenceTint,
      iridescence
    );
    vec3 diffuseColor = baseColor.rgb * (vec3(1.0) - dielectricSpecularF0);
    diffuseColor *= (1.0 - metallic) * (1.0 - transmission);
    vec3 specularColor = mix(dielectricSpecularF0, baseColor.rgb, metallic);

    float baseLayerEnergy = 1.0 - clearcoatFactor * 0.25;
    diffuseColor *= baseLayerEnergy;
    specularColor *= baseLayerEnergy;

    // Compute reflectance.
    float reflectance = max(max(specularColor.r, specularColor.g), specularColor.b);

    // For typical incident reflectance range (between 4% to 100%) set the grazing
    // reflectance to 100% for typical fresnel effect.
    // For very low reflectance range on highly diffuse objects (below 4%),
    // incrementally reduce grazing reflecance to 0%.
    float reflectance90 = clamp(reflectance * 25.0, 0.0, 1.0);
    vec3 specularEnvironmentR0 = specularColor.rgb;
    vec3 specularEnvironmentR90 = vec3(1.0, 1.0, 1.0) * reflectance90;
    vec3 reflection = -normalize(reflect(v, n));

    PBRInfo pbrInfo = PBRInfo(
      0.0, // NdotL
      NdotV,
      0.0, // NdotH
      0.0, // LdotH
      0.0, // VdotH
      perceptualRoughness,
      metallic,
      specularEnvironmentR0,
      specularEnvironmentR90,
      alphaRoughness,
      diffuseColor,
      specularColor,
      n,
      v
    );


#ifdef USE_LIGHTS
    // Apply ambient light
    PBRInfo_setAmbientLight(pbrInfo);
    color += calculateMaterialLightColor(
      pbrInfo,
      lighting.ambientColor,
      clearcoatNormal,
      clearcoatFactor,
      clearcoatRoughness,
      sheenColor,
      sheenRoughness,
      anisotropyTangent,
      anisotropyStrength
    );

    // Apply directional light
    for(int i = 0; i < lighting.directionalLightCount; i++) {
      if (i < lighting.directionalLightCount) {
        PBRInfo_setDirectionalLight(pbrInfo, lighting_getDirectionalLight(i).direction);
        color += calculateMaterialLightColor(
          pbrInfo,
          lighting_getDirectionalLight(i).color,
          clearcoatNormal,
          clearcoatFactor,
          clearcoatRoughness,
          sheenColor,
          sheenRoughness,
          anisotropyTangent,
          anisotropyStrength
        );
      }
    }

    // Apply point light
    for(int i = 0; i < lighting.pointLightCount; i++) {
      if (i < lighting.pointLightCount) {
        PBRInfo_setPointLight(pbrInfo, lighting_getPointLight(i));
        float attenuation = getPointLightAttenuation(lighting_getPointLight(i), distance(lighting_getPointLight(i).position, pbr_vPosition));
        color += calculateMaterialLightColor(
          pbrInfo,
          lighting_getPointLight(i).color / attenuation,
          clearcoatNormal,
          clearcoatFactor,
          clearcoatRoughness,
          sheenColor,
          sheenRoughness,
          anisotropyTangent,
          anisotropyStrength
        );
      }
    }

    for(int i = 0; i < lighting.spotLightCount; i++) {
      if (i < lighting.spotLightCount) {
        PBRInfo_setSpotLight(pbrInfo, lighting_getSpotLight(i));
        float attenuation = getSpotLightAttenuation(lighting_getSpotLight(i), pbr_vPosition);
        color += calculateMaterialLightColor(
          pbrInfo,
          lighting_getSpotLight(i).color / attenuation,
          clearcoatNormal,
          clearcoatFactor,
          clearcoatRoughness,
          sheenColor,
          sheenRoughness,
          anisotropyTangent,
          anisotropyStrength
        );
      }
    }
#endif

    // Calculate lighting contribution from image based lighting source (IBL)
#ifdef USE_IBL
    if (pbrMaterial.IBLenabled) {
      color += getIBLContribution(pbrInfo, n, reflection) *
        calculateAnisotropyBoost(pbrInfo, anisotropyTangent, anisotropyStrength);
      color += calculateClearcoatIBLContribution(
        pbrInfo,
        clearcoatNormal,
        -normalize(reflect(v, clearcoatNormal)),
        clearcoatFactor,
        clearcoatRoughness
      );
      color += sheenColor * pbrMaterial.scaleIBLAmbient.x * (1.0 - sheenRoughness) * 0.25;
    }
#endif

 // Apply optional PBR terms for additional (optional) shading
#ifdef HAS_OCCLUSIONMAP
    if (pbrMaterial.occlusionMapEnabled) {
      float ao = texture(pbr_occlusionSampler, occlusionUV).r;
      color = mix(color, color * ao, pbrMaterial.occlusionStrength);
    }
#endif

    vec3 emissive = pbrMaterial.emissiveFactor;
#ifdef HAS_EMISSIVEMAP
    if (pbrMaterial.emissiveMapEnabled) {
      emissive *= SRGBtoLINEAR(texture(pbr_emissiveSampler, emissiveUV)).rgb;
    }
#endif
    color += emissive * pbrMaterial.emissiveStrength;

    if (transmission > 0.0) {
      color = mix(color, color * getVolumeAttenuation(thickness), transmission);
    }

    // This section uses mix to override final color for reference app visualization
    // of various parameters in the lighting equation.
#ifdef PBR_DEBUG
    // TODO: Figure out how to debug multiple lights

    // color = mix(color, F, pbr_scaleFGDSpec.x);
    // color = mix(color, vec3(G), pbr_scaleFGDSpec.y);
    // color = mix(color, vec3(D), pbr_scaleFGDSpec.z);
    // color = mix(color, specContrib, pbr_scaleFGDSpec.w);

    // color = mix(color, diffuseContrib, pbr_scaleDiffBaseMR.x);
    color = mix(color, baseColor.rgb, pbrMaterial.scaleDiffBaseMR.y);
    color = mix(color, vec3(metallic), pbrMaterial.scaleDiffBaseMR.z);
    color = mix(color, vec3(perceptualRoughness), pbrMaterial.scaleDiffBaseMR.w);
#endif

  }

  float alpha = clamp(baseColor.a * (1.0 - transmission), 0.0, 1.0);
  return vec4(pow(color,vec3(1.0/2.2)), alpha);
}
`;var qs=`struct PBRFragmentInputs {
  pbr_vPosition: vec3f,
  pbr_vUV0: vec2f,
  pbr_vUV1: vec2f,
  pbr_vTBN: mat3x3f,
  pbr_vNormal: vec3f
};

var<private> fragmentInputs: PBRFragmentInputs;

fn pbr_setPositionNormalTangentUV(
  position: vec4f,
  normal: vec4f,
  tangent: vec4f,
  uv0: vec2f,
  uv1: vec2f
)
{
  var pos: vec4f = pbrProjection.modelMatrix * position;
  fragmentInputs.pbr_vPosition = pos.xyz / pos.w;
  fragmentInputs.pbr_vNormal = vec3f(0.0, 0.0, 1.0);
  fragmentInputs.pbr_vTBN = mat3x3f(
    vec3f(1.0, 0.0, 0.0),
    vec3f(0.0, 1.0, 0.0),
    vec3f(0.0, 0.0, 1.0)
  );
  fragmentInputs.pbr_vUV0 = vec2f(0.0, 0.0);
  fragmentInputs.pbr_vUV1 = uv1;

#ifdef HAS_NORMALS
  let normalW: vec3f = normalize((pbrProjection.normalMatrix * vec4f(normal.xyz, 0.0)).xyz);
  fragmentInputs.pbr_vNormal = normalW;
#ifdef HAS_TANGENTS
  let tangentW: vec3f = normalize((pbrProjection.modelMatrix * vec4f(tangent.xyz, 0.0)).xyz);
  let bitangentW: vec3f = cross(normalW, tangentW) * tangent.w;
  fragmentInputs.pbr_vTBN = mat3x3f(tangentW, bitangentW, normalW);
#endif
#endif

#ifdef HAS_UV
  fragmentInputs.pbr_vUV0 = uv0;
#endif
}

struct pbrMaterialUniforms {
  // Material is unlit
  unlit: u32,

  // Base color map
  baseColorMapEnabled: u32,
  baseColorFactor: vec4f,

  normalMapEnabled : u32,
  normalScale: f32,  // #ifdef HAS_NORMALMAP

  emissiveMapEnabled: u32,
  emissiveFactor: vec3f, // #ifdef HAS_EMISSIVEMAP

  metallicRoughnessValues: vec2f,
  metallicRoughnessMapEnabled: u32,

  occlusionMapEnabled: i32,
  occlusionStrength: f32, // #ifdef HAS_OCCLUSIONMAP

  alphaCutoffEnabled: i32,
  alphaCutoff: f32, // #ifdef ALPHA_CUTOFF

  specularColorFactor: vec3f,
  specularIntensityFactor: f32,
  specularColorMapEnabled: i32,
  specularIntensityMapEnabled: i32,

  ior: f32,

  transmissionFactor: f32,
  transmissionMapEnabled: i32,

  thicknessFactor: f32,
  attenuationDistance: f32,
  attenuationColor: vec3f,

  clearcoatFactor: f32,
  clearcoatRoughnessFactor: f32,
  clearcoatMapEnabled: i32,
  clearcoatRoughnessMapEnabled: i32,

  sheenColorFactor: vec3f,
  sheenRoughnessFactor: f32,
  sheenColorMapEnabled: i32,
  sheenRoughnessMapEnabled: i32,

  iridescenceFactor: f32,
  iridescenceIor: f32,
  iridescenceThicknessRange: vec2f,
  iridescenceMapEnabled: i32,

  anisotropyStrength: f32,
  anisotropyRotation: f32,
  anisotropyDirection: vec2f,
  anisotropyMapEnabled: i32,

  emissiveStrength: f32,

  // IBL
  IBLenabled: i32,
  scaleIBLAmbient: vec2f, // #ifdef USE_IBL

  // debugging flags used for shader output of intermediate PBR variables
  // #ifdef PBR_DEBUG
  scaleDiffBaseMR: vec4f,
  scaleFGDSpec: vec4f,
  // #endif

  baseColorUVSet: i32,
  baseColorUVTransform: mat3x3f,
  metallicRoughnessUVSet: i32,
  metallicRoughnessUVTransform: mat3x3f,
  normalUVSet: i32,
  normalUVTransform: mat3x3f,
  occlusionUVSet: i32,
  occlusionUVTransform: mat3x3f,
  emissiveUVSet: i32,
  emissiveUVTransform: mat3x3f,
  specularColorUVSet: i32,
  specularColorUVTransform: mat3x3f,
  specularIntensityUVSet: i32,
  specularIntensityUVTransform: mat3x3f,
  transmissionUVSet: i32,
  transmissionUVTransform: mat3x3f,
  thicknessUVSet: i32,
  thicknessUVTransform: mat3x3f,
  clearcoatUVSet: i32,
  clearcoatUVTransform: mat3x3f,
  clearcoatRoughnessUVSet: i32,
  clearcoatRoughnessUVTransform: mat3x3f,
  clearcoatNormalUVSet: i32,
  clearcoatNormalUVTransform: mat3x3f,
  sheenColorUVSet: i32,
  sheenColorUVTransform: mat3x3f,
  sheenRoughnessUVSet: i32,
  sheenRoughnessUVTransform: mat3x3f,
  iridescenceUVSet: i32,
  iridescenceUVTransform: mat3x3f,
  iridescenceThicknessUVSet: i32,
  iridescenceThicknessUVTransform: mat3x3f,
  anisotropyUVSet: i32,
  anisotropyUVTransform: mat3x3f,
}

@group(3) @binding(auto) var<uniform> pbrMaterial : pbrMaterialUniforms;

// Samplers
#ifdef HAS_BASECOLORMAP
@group(3) @binding(auto) var pbr_baseColorSampler: texture_2d<f32>;
@group(3) @binding(auto) var pbr_baseColorSamplerSampler: sampler;
#endif
#ifdef HAS_NORMALMAP
@group(3) @binding(auto) var pbr_normalSampler: texture_2d<f32>;
@group(3) @binding(auto) var pbr_normalSamplerSampler: sampler;
#endif
#ifdef HAS_EMISSIVEMAP
@group(3) @binding(auto) var pbr_emissiveSampler: texture_2d<f32>;
@group(3) @binding(auto) var pbr_emissiveSamplerSampler: sampler;
#endif
#ifdef HAS_METALROUGHNESSMAP
@group(3) @binding(auto) var pbr_metallicRoughnessSampler: texture_2d<f32>;
@group(3) @binding(auto) var pbr_metallicRoughnessSamplerSampler: sampler;
#endif
#ifdef HAS_OCCLUSIONMAP
@group(3) @binding(auto) var pbr_occlusionSampler: texture_2d<f32>;
@group(3) @binding(auto) var pbr_occlusionSamplerSampler: sampler;
#endif
#ifdef HAS_SPECULARCOLORMAP
@group(3) @binding(auto) var pbr_specularColorSampler: texture_2d<f32>;
@group(3) @binding(auto) var pbr_specularColorSamplerSampler: sampler;
#endif
#ifdef HAS_SPECULARINTENSITYMAP
@group(3) @binding(auto) var pbr_specularIntensitySampler: texture_2d<f32>;
@group(3) @binding(auto) var pbr_specularIntensitySamplerSampler: sampler;
#endif
#ifdef HAS_TRANSMISSIONMAP
@group(3) @binding(auto) var pbr_transmissionSampler: texture_2d<f32>;
@group(3) @binding(auto) var pbr_transmissionSamplerSampler: sampler;
#endif
#ifdef HAS_THICKNESSMAP
@group(3) @binding(auto) var pbr_thicknessSampler: texture_2d<f32>;
@group(3) @binding(auto) var pbr_thicknessSamplerSampler: sampler;
#endif
#ifdef HAS_CLEARCOATMAP
@group(3) @binding(auto) var pbr_clearcoatSampler: texture_2d<f32>;
@group(3) @binding(auto) var pbr_clearcoatSamplerSampler: sampler;
#endif
#ifdef HAS_CLEARCOATROUGHNESSMAP
@group(3) @binding(auto) var pbr_clearcoatRoughnessSampler: texture_2d<f32>;
@group(3) @binding(auto) var pbr_clearcoatRoughnessSamplerSampler: sampler;
#endif
#ifdef HAS_CLEARCOATNORMALMAP
@group(3) @binding(auto) var pbr_clearcoatNormalSampler: texture_2d<f32>;
@group(3) @binding(auto) var pbr_clearcoatNormalSamplerSampler: sampler;
#endif
#ifdef HAS_SHEENCOLORMAP
@group(3) @binding(auto) var pbr_sheenColorSampler: texture_2d<f32>;
@group(3) @binding(auto) var pbr_sheenColorSamplerSampler: sampler;
#endif
#ifdef HAS_SHEENROUGHNESSMAP
@group(3) @binding(auto) var pbr_sheenRoughnessSampler: texture_2d<f32>;
@group(3) @binding(auto) var pbr_sheenRoughnessSamplerSampler: sampler;
#endif
#ifdef HAS_IRIDESCENCEMAP
@group(3) @binding(auto) var pbr_iridescenceSampler: texture_2d<f32>;
@group(3) @binding(auto) var pbr_iridescenceSamplerSampler: sampler;
#endif
#ifdef HAS_IRIDESCENCETHICKNESSMAP
@group(3) @binding(auto) var pbr_iridescenceThicknessSampler: texture_2d<f32>;
@group(3) @binding(auto) var pbr_iridescenceThicknessSamplerSampler: sampler;
#endif
#ifdef HAS_ANISOTROPYMAP
@group(3) @binding(auto) var pbr_anisotropySampler: texture_2d<f32>;
@group(3) @binding(auto) var pbr_anisotropySamplerSampler: sampler;
#endif
// Encapsulate the various inputs used by the various functions in the shading equation
// We store values in this struct to simplify the integration of alternative implementations
// of the shading terms, outlined in the Readme.MD Appendix.
struct PBRInfo {
  NdotL: f32,                  // cos angle between normal and light direction
  NdotV: f32,                  // cos angle between normal and view direction
  NdotH: f32,                  // cos angle between normal and half vector
  LdotH: f32,                  // cos angle between light direction and half vector
  VdotH: f32,                  // cos angle between view direction and half vector
  perceptualRoughness: f32,    // roughness value, as authored by the model creator (input to shader)
  metalness: f32,              // metallic value at the surface
  reflectance0: vec3f,            // full reflectance color (normal incidence angle)
  reflectance90: vec3f,           // reflectance color at grazing angle
  alphaRoughness: f32,         // roughness mapped to a more linear change in the roughness (proposed by [2])
  diffuseColor: vec3f,            // color contribution from diffuse lighting
  specularColor: vec3f,           // color contribution from specular lighting
  n: vec3f,                       // normal at surface point
  v: vec3f,                       // vector from surface point to camera
};

const M_PI = 3.141592653589793;
const c_MinRoughness = 0.04;

fn SRGBtoLINEAR(srgbIn: vec4f ) -> vec4f
{
  var linOut: vec3f = srgbIn.xyz;
#ifdef MANUAL_SRGB
  let bLess: vec3f = step(vec3f(0.04045), srgbIn.xyz);
  linOut = mix(
    srgbIn.xyz / vec3f(12.92),
    pow((srgbIn.xyz + vec3f(0.055)) / vec3f(1.055), vec3f(2.4)),
    bLess
  );
#ifdef SRGB_FAST_APPROXIMATION
  linOut = pow(srgbIn.xyz, vec3f(2.2));
#endif
#endif
  return vec4f(linOut, srgbIn.w);
}

fn getMaterialUV(uvSet: i32, uvTransform: mat3x3f) -> vec2f
{
  var baseUV = fragmentInputs.pbr_vUV0;
  if (uvSet == 1) {
    baseUV = fragmentInputs.pbr_vUV1;
  }
  return (uvTransform * vec3f(baseUV, 1.0)).xy;
}

// Build the tangent basis from interpolated attributes or screen-space derivatives.
fn getTBN(uv: vec2f) -> mat3x3f
{
  let pos_dx: vec3f = dpdx(fragmentInputs.pbr_vPosition);
  let pos_dy: vec3f = dpdy(fragmentInputs.pbr_vPosition);
  let tex_dx: vec3f = dpdx(vec3f(uv, 0.0));
  let tex_dy: vec3f = dpdy(vec3f(uv, 0.0));
  var t: vec3f = (tex_dy.y * pos_dx - tex_dx.y * pos_dy) / (tex_dx.x * tex_dy.y - tex_dy.x * tex_dx.y);

  var ng: vec3f = cross(pos_dx, pos_dy);
#ifdef HAS_NORMALS
  ng = normalize(fragmentInputs.pbr_vNormal);
#endif
  t = normalize(t - ng * dot(ng, t));
  var b: vec3f = normalize(cross(ng, t));
  var tbn: mat3x3f = mat3x3f(t, b, ng);
#ifdef HAS_TANGENTS
  tbn = fragmentInputs.pbr_vTBN;
#endif

  return tbn;
}

// Find the normal for this fragment, pulling either from a predefined normal map
// or from the interpolated mesh normal and tangent attributes.
fn getMappedNormal(
  normalSampler: texture_2d<f32>,
  normalSamplerBinding: sampler,
  tbn: mat3x3f,
  normalScale: f32,
  uv: vec2f
) -> vec3f
{
  let n = textureSample(normalSampler, normalSamplerBinding, uv).rgb;
  return normalize(tbn * ((2.0 * n - 1.0) * vec3f(normalScale, normalScale, 1.0)));
}

fn getNormal(tbn: mat3x3f, uv: vec2f) -> vec3f
{
  // The tbn matrix is linearly interpolated, so we need to re-normalize
  var n: vec3f = normalize(tbn[2].xyz);
#ifdef HAS_NORMALMAP
  n = getMappedNormal(
    pbr_normalSampler,
    pbr_normalSamplerSampler,
    tbn,
    pbrMaterial.normalScale,
    uv
  );
#endif

  return n;
}

fn getClearcoatNormal(tbn: mat3x3f, baseNormal: vec3f, uv: vec2f) -> vec3f
{
#ifdef HAS_CLEARCOATNORMALMAP
  return getMappedNormal(
    pbr_clearcoatNormalSampler,
    pbr_clearcoatNormalSamplerSampler,
    tbn,
    1.0,
    uv
  );
#else
  return baseNormal;
#endif
}

// Calculation of the lighting contribution from an optional Image Based Light source.
// Precomputed Environment Maps are required uniform inputs and are computed as outlined in [1].
// See our README.md on Environment Maps [3] for additional discussion.
#ifdef USE_IBL
fn getIBLContribution(pbrInfo: PBRInfo, n: vec3f, reflection: vec3f) -> vec3f
{
  let mipCount: f32 = 9.0; // resolution of 512x512
  let lod: f32 = pbrInfo.perceptualRoughness * mipCount;
  // retrieve a scale and bias to F0. See [1], Figure 3
  let brdf = SRGBtoLINEAR(
    textureSampleLevel(
      pbr_brdfLUT,
      pbr_brdfLUTSampler,
      vec2f(pbrInfo.NdotV, 1.0 - pbrInfo.perceptualRoughness),
      0.0
    )
  ).rgb;
  let diffuseLight =
    SRGBtoLINEAR(
      textureSampleLevel(pbr_diffuseEnvSampler, pbr_diffuseEnvSamplerSampler, n, 0.0)
    ).rgb;
  var specularLight = SRGBtoLINEAR(
    textureSampleLevel(
      pbr_specularEnvSampler,
      pbr_specularEnvSamplerSampler,
      reflection,
      0.0
    )
  ).rgb;
#ifdef USE_TEX_LOD
  specularLight = SRGBtoLINEAR(
    textureSampleLevel(
      pbr_specularEnvSampler,
      pbr_specularEnvSamplerSampler,
      reflection,
      lod
    )
  ).rgb;
#endif

  let diffuse = diffuseLight * pbrInfo.diffuseColor * pbrMaterial.scaleIBLAmbient.x;
  let specular =
    specularLight * (pbrInfo.specularColor * brdf.x + brdf.y) * pbrMaterial.scaleIBLAmbient.y;

  return diffuse + specular;
}
#endif

// Basic Lambertian diffuse
// Implementation from Lambert's Photometria https://archive.org/details/lambertsphotome00lambgoog
// See also [1], Equation 1
fn diffuse(pbrInfo: PBRInfo) -> vec3<f32> {
  return pbrInfo.diffuseColor / M_PI;
}

// The following equation models the Fresnel reflectance term of the spec equation (aka F())
// Implementation of fresnel from [4], Equation 15
fn specularReflection(pbrInfo: PBRInfo) -> vec3<f32> {
  return pbrInfo.reflectance0 +
    (pbrInfo.reflectance90 - pbrInfo.reflectance0) *
    pow(clamp(1.0 - pbrInfo.VdotH, 0.0, 1.0), 5.0);
}

// This calculates the specular geometric attenuation (aka G()),
// where rougher material will reflect less light back to the viewer.
// This implementation is based on [1] Equation 4, and we adopt their modifications to
// alphaRoughness as input as originally proposed in [2].
fn geometricOcclusion(pbrInfo: PBRInfo) -> f32 {
  let NdotL: f32 = pbrInfo.NdotL;
  let NdotV: f32 = pbrInfo.NdotV;
  let r: f32 = pbrInfo.alphaRoughness;

  let attenuationL = 2.0 * NdotL / (NdotL + sqrt(r * r + (1.0 - r * r) * (NdotL * NdotL)));
  let attenuationV = 2.0 * NdotV / (NdotV + sqrt(r * r + (1.0 - r * r) * (NdotV * NdotV)));
  return attenuationL * attenuationV;
}

// The following equation(s) model the distribution of microfacet normals across
// the area being drawn (aka D())
// Implementation from "Average Irregularity Representation of a Roughened Surface
// for Ray Reflection" by T. S. Trowbridge, and K. P. Reitz
// Follows the distribution function recommended in the SIGGRAPH 2013 course notes
// from EPIC Games [1], Equation 3.
fn microfacetDistribution(pbrInfo: PBRInfo) -> f32 {
  let roughnessSq = pbrInfo.alphaRoughness * pbrInfo.alphaRoughness;
  let f = (pbrInfo.NdotH * roughnessSq - pbrInfo.NdotH) * pbrInfo.NdotH + 1.0;
  return roughnessSq / (M_PI * f * f);
}

fn maxComponent(value: vec3f) -> f32 {
  return max(max(value.r, value.g), value.b);
}

fn getDielectricF0(ior: f32) -> f32 {
  let clampedIor = max(ior, 1.0);
  let ratio = (clampedIor - 1.0) / (clampedIor + 1.0);
  return ratio * ratio;
}

fn normalizeDirection(direction: vec2f) -> vec2f {
  let directionLength = length(direction);
  if (directionLength > 0.0001) {
    return direction / directionLength;
  }

  return vec2f(1.0, 0.0);
}

fn rotateDirection(direction: vec2f, rotation: f32) -> vec2f {
  let s = sin(rotation);
  let c = cos(rotation);
  return vec2f(direction.x * c - direction.y * s, direction.x * s + direction.y * c);
}

fn getIridescenceTint(iridescence: f32, thickness: f32, NdotV: f32) -> vec3f {
  if (iridescence <= 0.0) {
    return vec3f(1.0);
  }

  let phase = 0.015 * thickness * pbrMaterial.iridescenceIor + (1.0 - NdotV) * 6.0;
  let thinFilmTint =
    0.5 +
    0.5 *
    cos(vec3f(phase, phase + 2.0943951, phase + 4.1887902));
  return mix(vec3f(1.0), thinFilmTint, iridescence);
}

fn getVolumeAttenuation(thickness: f32) -> vec3f {
  if (thickness <= 0.0) {
    return vec3f(1.0);
  }

  let attenuationCoefficient =
    -log(max(pbrMaterial.attenuationColor, vec3f(0.0001))) /
    max(pbrMaterial.attenuationDistance, 0.0001);
  return exp(-attenuationCoefficient * thickness);
}

fn createClearcoatPBRInfo(
  basePBRInfo: PBRInfo,
  clearcoatNormal: vec3f,
  clearcoatRoughness: f32
) -> PBRInfo {
  let perceptualRoughness = clamp(clearcoatRoughness, c_MinRoughness, 1.0);
  let alphaRoughness = perceptualRoughness * perceptualRoughness;
  let NdotV = clamp(abs(dot(clearcoatNormal, basePBRInfo.v)), 0.001, 1.0);

  return PBRInfo(
    basePBRInfo.NdotL,
    NdotV,
    basePBRInfo.NdotH,
    basePBRInfo.LdotH,
    basePBRInfo.VdotH,
    perceptualRoughness,
    0.0,
    vec3f(0.04),
    vec3f(1.0),
    alphaRoughness,
    vec3f(0.0),
    vec3f(0.04),
    clearcoatNormal,
    basePBRInfo.v
  );
}

fn calculateClearcoatContribution(
  pbrInfo: PBRInfo,
  lightColor: vec3f,
  clearcoatNormal: vec3f,
  clearcoatFactor: f32,
  clearcoatRoughness: f32
) -> vec3f {
  if (clearcoatFactor <= 0.0) {
    return vec3f(0.0);
  }

  let clearcoatPBRInfo = createClearcoatPBRInfo(pbrInfo, clearcoatNormal, clearcoatRoughness);
  return calculateFinalColor(clearcoatPBRInfo, lightColor) * clearcoatFactor;
}

#ifdef USE_IBL
fn calculateClearcoatIBLContribution(
  pbrInfo: PBRInfo,
  clearcoatNormal: vec3f,
  reflection: vec3f,
  clearcoatFactor: f32,
  clearcoatRoughness: f32
) -> vec3f {
  if (clearcoatFactor <= 0.0) {
    return vec3f(0.0);
  }

  let clearcoatPBRInfo = createClearcoatPBRInfo(pbrInfo, clearcoatNormal, clearcoatRoughness);
  return getIBLContribution(clearcoatPBRInfo, clearcoatNormal, reflection) * clearcoatFactor;
}
#endif

fn calculateSheenContribution(
  pbrInfo: PBRInfo,
  lightColor: vec3f,
  sheenColor: vec3f,
  sheenRoughness: f32
) -> vec3f {
  if (maxComponent(sheenColor) <= 0.0) {
    return vec3f(0.0);
  }

  let sheenFresnel = pow(clamp(1.0 - pbrInfo.VdotH, 0.0, 1.0), 5.0);
  let sheenVisibility = mix(1.0, pbrInfo.NdotL * pbrInfo.NdotV, sheenRoughness);
  return pbrInfo.NdotL *
    lightColor *
    sheenColor *
    (0.25 + 0.75 * sheenFresnel) *
    sheenVisibility *
    (1.0 - pbrInfo.metalness);
}

fn calculateAnisotropyBoost(
  pbrInfo: PBRInfo,
  anisotropyTangent: vec3f,
  anisotropyStrength: f32
) -> f32 {
  if (anisotropyStrength <= 0.0) {
    return 1.0;
  }

  let anisotropyBitangent = normalize(cross(pbrInfo.n, anisotropyTangent));
  let bitangentViewAlignment = abs(dot(pbrInfo.v, anisotropyBitangent));
  return mix(1.0, 0.65 + 0.7 * bitangentViewAlignment, anisotropyStrength);
}

fn calculateMaterialLightColor(
  pbrInfo: PBRInfo,
  lightColor: vec3f,
  clearcoatNormal: vec3f,
  clearcoatFactor: f32,
  clearcoatRoughness: f32,
  sheenColor: vec3f,
  sheenRoughness: f32,
  anisotropyTangent: vec3f,
  anisotropyStrength: f32
) -> vec3f {
  let anisotropyBoost = calculateAnisotropyBoost(pbrInfo, anisotropyTangent, anisotropyStrength);
  var color = calculateFinalColor(pbrInfo, lightColor) * anisotropyBoost;
  color += calculateClearcoatContribution(
    pbrInfo,
    lightColor,
    clearcoatNormal,
    clearcoatFactor,
    clearcoatRoughness
  );
  color += calculateSheenContribution(pbrInfo, lightColor, sheenColor, sheenRoughness);
  return color;
}

fn PBRInfo_setAmbientLight(pbrInfo: ptr<function, PBRInfo>) {
  (*pbrInfo).NdotL = 1.0;
  (*pbrInfo).NdotH = 0.0;
  (*pbrInfo).LdotH = 0.0;
  (*pbrInfo).VdotH = 1.0;
}

fn PBRInfo_setDirectionalLight(pbrInfo: ptr<function, PBRInfo>, lightDirection: vec3<f32>) {
  let n = (*pbrInfo).n;
  let v = (*pbrInfo).v;
  let l = normalize(lightDirection);             // Vector from surface point to light
  let h = normalize(l + v);                      // Half vector between both l and v

  (*pbrInfo).NdotL = clamp(dot(n, l), 0.001, 1.0);
  (*pbrInfo).NdotH = clamp(dot(n, h), 0.0, 1.0);
  (*pbrInfo).LdotH = clamp(dot(l, h), 0.0, 1.0);
  (*pbrInfo).VdotH = clamp(dot(v, h), 0.0, 1.0);
}

fn PBRInfo_setPointLight(pbrInfo: ptr<function, PBRInfo>, pointLight: PointLight) {
  let light_direction = normalize(pointLight.position - fragmentInputs.pbr_vPosition);
  PBRInfo_setDirectionalLight(pbrInfo, light_direction);
}

fn PBRInfo_setSpotLight(pbrInfo: ptr<function, PBRInfo>, spotLight: SpotLight) {
  let light_direction = normalize(spotLight.position - fragmentInputs.pbr_vPosition);
  PBRInfo_setDirectionalLight(pbrInfo, light_direction);
}

fn calculateFinalColor(pbrInfo: PBRInfo, lightColor: vec3<f32>) -> vec3<f32> {
  // Calculate the shading terms for the microfacet specular shading model
  let F = specularReflection(pbrInfo);
  let G = geometricOcclusion(pbrInfo);
  let D = microfacetDistribution(pbrInfo);

  // Calculation of analytical lighting contribution
  let diffuseContrib = (1.0 - F) * diffuse(pbrInfo);
  let specContrib = F * G * D / (4.0 * pbrInfo.NdotL * pbrInfo.NdotV);
  // Obtain final intensity as reflectance (BRDF) scaled by the energy of the light (cosine law)
  return pbrInfo.NdotL * lightColor * (diffuseContrib + specContrib);
}

fn pbr_filterColor(colorUnused: vec4<f32>) -> vec4<f32> {
  let baseColorUV = getMaterialUV(pbrMaterial.baseColorUVSet, pbrMaterial.baseColorUVTransform);
  let metallicRoughnessUV = getMaterialUV(
    pbrMaterial.metallicRoughnessUVSet,
    pbrMaterial.metallicRoughnessUVTransform
  );
  let normalUV = getMaterialUV(pbrMaterial.normalUVSet, pbrMaterial.normalUVTransform);
  let occlusionUV = getMaterialUV(pbrMaterial.occlusionUVSet, pbrMaterial.occlusionUVTransform);
  let emissiveUV = getMaterialUV(pbrMaterial.emissiveUVSet, pbrMaterial.emissiveUVTransform);
  let specularColorUV = getMaterialUV(
    pbrMaterial.specularColorUVSet,
    pbrMaterial.specularColorUVTransform
  );
  let specularIntensityUV = getMaterialUV(
    pbrMaterial.specularIntensityUVSet,
    pbrMaterial.specularIntensityUVTransform
  );
  let transmissionUV = getMaterialUV(
    pbrMaterial.transmissionUVSet,
    pbrMaterial.transmissionUVTransform
  );
  let thicknessUV = getMaterialUV(pbrMaterial.thicknessUVSet, pbrMaterial.thicknessUVTransform);
  let clearcoatUV = getMaterialUV(pbrMaterial.clearcoatUVSet, pbrMaterial.clearcoatUVTransform);
  let clearcoatRoughnessUV = getMaterialUV(
    pbrMaterial.clearcoatRoughnessUVSet,
    pbrMaterial.clearcoatRoughnessUVTransform
  );
  let clearcoatNormalUV = getMaterialUV(
    pbrMaterial.clearcoatNormalUVSet,
    pbrMaterial.clearcoatNormalUVTransform
  );
  let sheenColorUV = getMaterialUV(
    pbrMaterial.sheenColorUVSet,
    pbrMaterial.sheenColorUVTransform
  );
  let sheenRoughnessUV = getMaterialUV(
    pbrMaterial.sheenRoughnessUVSet,
    pbrMaterial.sheenRoughnessUVTransform
  );
  let iridescenceUV = getMaterialUV(
    pbrMaterial.iridescenceUVSet,
    pbrMaterial.iridescenceUVTransform
  );
  let iridescenceThicknessUV = getMaterialUV(
    pbrMaterial.iridescenceThicknessUVSet,
    pbrMaterial.iridescenceThicknessUVTransform
  );
  let anisotropyUV = getMaterialUV(
    pbrMaterial.anisotropyUVSet,
    pbrMaterial.anisotropyUVTransform
  );

  // The albedo may be defined from a base texture or a flat color
  var baseColor: vec4<f32> = pbrMaterial.baseColorFactor;
  #ifdef HAS_BASECOLORMAP
  baseColor = SRGBtoLINEAR(
    textureSample(pbr_baseColorSampler, pbr_baseColorSamplerSampler, baseColorUV)
  ) * pbrMaterial.baseColorFactor;
  #endif

  #ifdef ALPHA_CUTOFF
  if (baseColor.a < pbrMaterial.alphaCutoff) {
    discard;
  }
  #endif

  var color = vec3<f32>(0.0, 0.0, 0.0);
  var transmission = 0.0;

  if (pbrMaterial.unlit != 0u) {
    color = baseColor.rgb;
  } else {
    // Metallic and Roughness material properties are packed together
    // In glTF, these factors can be specified by fixed scalar values
    // or from a metallic-roughness map
    var perceptualRoughness = pbrMaterial.metallicRoughnessValues.y;
    var metallic = pbrMaterial.metallicRoughnessValues.x;
    #ifdef HAS_METALROUGHNESSMAP
    // Roughness is stored in the 'g' channel, metallic is stored in the 'b' channel.
    // This layout intentionally reserves the 'r' channel for (optional) occlusion map data
    let mrSample = textureSample(
      pbr_metallicRoughnessSampler,
      pbr_metallicRoughnessSamplerSampler,
      metallicRoughnessUV
    );
    perceptualRoughness = mrSample.g * perceptualRoughness;
    metallic = mrSample.b * metallic;
    #endif
    perceptualRoughness = clamp(perceptualRoughness, c_MinRoughness, 1.0);
    metallic = clamp(metallic, 0.0, 1.0);
    let tbn = getTBN(normalUV);
    let n = getNormal(tbn, normalUV);                          // normal at surface point
    let v = normalize(pbrProjection.camera - fragmentInputs.pbr_vPosition);  // Vector from surface point to camera
    let NdotV = clamp(abs(dot(n, v)), 0.001, 1.0);
    var useExtendedPBR = false;
    #ifdef USE_MATERIAL_EXTENSIONS
    useExtendedPBR =
      pbrMaterial.specularColorMapEnabled != 0 ||
      pbrMaterial.specularIntensityMapEnabled != 0 ||
      abs(pbrMaterial.specularIntensityFactor - 1.0) > 0.0001 ||
      maxComponent(abs(pbrMaterial.specularColorFactor - vec3f(1.0))) > 0.0001 ||
      abs(pbrMaterial.ior - 1.5) > 0.0001 ||
      pbrMaterial.transmissionMapEnabled != 0 ||
      pbrMaterial.transmissionFactor > 0.0001 ||
      pbrMaterial.clearcoatMapEnabled != 0 ||
      pbrMaterial.clearcoatRoughnessMapEnabled != 0 ||
      pbrMaterial.clearcoatFactor > 0.0001 ||
      pbrMaterial.clearcoatRoughnessFactor > 0.0001 ||
      pbrMaterial.sheenColorMapEnabled != 0 ||
      pbrMaterial.sheenRoughnessMapEnabled != 0 ||
      maxComponent(pbrMaterial.sheenColorFactor) > 0.0001 ||
      pbrMaterial.sheenRoughnessFactor > 0.0001 ||
      pbrMaterial.iridescenceMapEnabled != 0 ||
      pbrMaterial.iridescenceFactor > 0.0001 ||
      abs(pbrMaterial.iridescenceIor - 1.3) > 0.0001 ||
      abs(pbrMaterial.iridescenceThicknessRange.x - 100.0) > 0.0001 ||
      abs(pbrMaterial.iridescenceThicknessRange.y - 400.0) > 0.0001 ||
      pbrMaterial.anisotropyMapEnabled != 0 ||
      pbrMaterial.anisotropyStrength > 0.0001 ||
      abs(pbrMaterial.anisotropyRotation) > 0.0001 ||
      length(pbrMaterial.anisotropyDirection - vec2f(1.0, 0.0)) > 0.0001;
    #endif

    if (!useExtendedPBR) {
      let alphaRoughness = perceptualRoughness * perceptualRoughness;

      let f0 = vec3<f32>(0.04);
      var diffuseColor = baseColor.rgb * (vec3<f32>(1.0) - f0);
      diffuseColor *= 1.0 - metallic;
      let specularColor = mix(f0, baseColor.rgb, metallic);

      let reflectance = max(max(specularColor.r, specularColor.g), specularColor.b);
      let reflectance90 = clamp(reflectance * 25.0, 0.0, 1.0);
      let specularEnvironmentR0 = specularColor;
      let specularEnvironmentR90 = vec3<f32>(1.0, 1.0, 1.0) * reflectance90;
      let reflection = -normalize(reflect(v, n));

      var pbrInfo = PBRInfo(
        0.0, // NdotL
        NdotV,
        0.0, // NdotH
        0.0, // LdotH
        0.0, // VdotH
        perceptualRoughness,
        metallic,
        specularEnvironmentR0,
        specularEnvironmentR90,
        alphaRoughness,
        diffuseColor,
        specularColor,
        n,
        v
      );

      #ifdef USE_LIGHTS
      PBRInfo_setAmbientLight(&pbrInfo);
      color += calculateFinalColor(pbrInfo, lighting.ambientColor);

      for (var i = 0; i < lighting.directionalLightCount; i++) {
        if (i < lighting.directionalLightCount) {
          PBRInfo_setDirectionalLight(&pbrInfo, lighting_getDirectionalLight(i).direction);
          color += calculateFinalColor(pbrInfo, lighting_getDirectionalLight(i).color);
        }
      }

      for (var i = 0; i < lighting.pointLightCount; i++) {
        if (i < lighting.pointLightCount) {
          PBRInfo_setPointLight(&pbrInfo, lighting_getPointLight(i));
          let attenuation = getPointLightAttenuation(
            lighting_getPointLight(i),
            distance(lighting_getPointLight(i).position, fragmentInputs.pbr_vPosition)
          );
          color += calculateFinalColor(pbrInfo, lighting_getPointLight(i).color / attenuation);
        }
      }

      for (var i = 0; i < lighting.spotLightCount; i++) {
        if (i < lighting.spotLightCount) {
          PBRInfo_setSpotLight(&pbrInfo, lighting_getSpotLight(i));
          let attenuation = getSpotLightAttenuation(
            lighting_getSpotLight(i),
            fragmentInputs.pbr_vPosition
          );
          color += calculateFinalColor(pbrInfo, lighting_getSpotLight(i).color / attenuation);
        }
      }
      #endif

      #ifdef USE_IBL
      if (pbrMaterial.IBLenabled != 0) {
        color += getIBLContribution(pbrInfo, n, reflection);
      }
      #endif

      #ifdef HAS_OCCLUSIONMAP
      if (pbrMaterial.occlusionMapEnabled != 0) {
        let ao = textureSample(pbr_occlusionSampler, pbr_occlusionSamplerSampler, occlusionUV).r;
        color = mix(color, color * ao, pbrMaterial.occlusionStrength);
      }
      #endif

      var emissive = pbrMaterial.emissiveFactor;
      #ifdef HAS_EMISSIVEMAP
      if (pbrMaterial.emissiveMapEnabled != 0u) {
        emissive *= SRGBtoLINEAR(
          textureSample(pbr_emissiveSampler, pbr_emissiveSamplerSampler, emissiveUV)
        ).rgb;
      }
      #endif
      color += emissive * pbrMaterial.emissiveStrength;

      #ifdef PBR_DEBUG
      color = mix(color, baseColor.rgb, pbrMaterial.scaleDiffBaseMR.y);
      color = mix(color, vec3<f32>(metallic), pbrMaterial.scaleDiffBaseMR.z);
      color = mix(color, vec3<f32>(perceptualRoughness), pbrMaterial.scaleDiffBaseMR.w);
      #endif

      return vec4<f32>(pow(color, vec3<f32>(1.0 / 2.2)), baseColor.a);
    }

    var specularIntensity = pbrMaterial.specularIntensityFactor;
    #ifdef HAS_SPECULARINTENSITYMAP
    if (pbrMaterial.specularIntensityMapEnabled != 0) {
      specularIntensity *= textureSample(
        pbr_specularIntensitySampler,
        pbr_specularIntensitySamplerSampler,
        specularIntensityUV
      ).a;
    }
    #endif

    var specularFactor = pbrMaterial.specularColorFactor;
    #ifdef HAS_SPECULARCOLORMAP
    if (pbrMaterial.specularColorMapEnabled != 0) {
      specularFactor *= SRGBtoLINEAR(
        textureSample(
          pbr_specularColorSampler,
          pbr_specularColorSamplerSampler,
          specularColorUV
        )
      ).rgb;
    }
    #endif

    transmission = pbrMaterial.transmissionFactor;
    #ifdef HAS_TRANSMISSIONMAP
    if (pbrMaterial.transmissionMapEnabled != 0) {
      transmission *= textureSample(
        pbr_transmissionSampler,
        pbr_transmissionSamplerSampler,
        transmissionUV
      ).r;
    }
    #endif
    transmission = clamp(transmission * (1.0 - metallic), 0.0, 1.0);
    var thickness = max(pbrMaterial.thicknessFactor, 0.0);
    #ifdef HAS_THICKNESSMAP
    thickness *= textureSample(
      pbr_thicknessSampler,
      pbr_thicknessSamplerSampler,
      thicknessUV
    ).g;
    #endif

    var clearcoatFactor = pbrMaterial.clearcoatFactor;
    var clearcoatRoughness = pbrMaterial.clearcoatRoughnessFactor;
    #ifdef HAS_CLEARCOATMAP
    if (pbrMaterial.clearcoatMapEnabled != 0) {
      clearcoatFactor *= textureSample(
        pbr_clearcoatSampler,
        pbr_clearcoatSamplerSampler,
        clearcoatUV
      ).r;
    }
    #endif
    #ifdef HAS_CLEARCOATROUGHNESSMAP
    if (pbrMaterial.clearcoatRoughnessMapEnabled != 0) {
      clearcoatRoughness *= textureSample(
        pbr_clearcoatRoughnessSampler,
        pbr_clearcoatRoughnessSamplerSampler,
        clearcoatRoughnessUV
      ).g;
    }
    #endif
    clearcoatFactor = clamp(clearcoatFactor, 0.0, 1.0);
    clearcoatRoughness = clamp(clearcoatRoughness, c_MinRoughness, 1.0);
    let clearcoatNormal = getClearcoatNormal(getTBN(clearcoatNormalUV), n, clearcoatNormalUV);

    var sheenColor = pbrMaterial.sheenColorFactor;
    var sheenRoughness = pbrMaterial.sheenRoughnessFactor;
    #ifdef HAS_SHEENCOLORMAP
    if (pbrMaterial.sheenColorMapEnabled != 0) {
      sheenColor *= SRGBtoLINEAR(
        textureSample(
          pbr_sheenColorSampler,
          pbr_sheenColorSamplerSampler,
          sheenColorUV
        )
      ).rgb;
    }
    #endif
    #ifdef HAS_SHEENROUGHNESSMAP
    if (pbrMaterial.sheenRoughnessMapEnabled != 0) {
      sheenRoughness *= textureSample(
        pbr_sheenRoughnessSampler,
        pbr_sheenRoughnessSamplerSampler,
        sheenRoughnessUV
      ).a;
    }
    #endif
    sheenRoughness = clamp(sheenRoughness, c_MinRoughness, 1.0);

    var iridescence = pbrMaterial.iridescenceFactor;
    #ifdef HAS_IRIDESCENCEMAP
    if (pbrMaterial.iridescenceMapEnabled != 0) {
      iridescence *= textureSample(
        pbr_iridescenceSampler,
        pbr_iridescenceSamplerSampler,
        iridescenceUV
      ).r;
    }
    #endif
    iridescence = clamp(iridescence, 0.0, 1.0);
    var iridescenceThickness = mix(
      pbrMaterial.iridescenceThicknessRange.x,
      pbrMaterial.iridescenceThicknessRange.y,
      0.5
    );
    #ifdef HAS_IRIDESCENCETHICKNESSMAP
    iridescenceThickness = mix(
      pbrMaterial.iridescenceThicknessRange.x,
      pbrMaterial.iridescenceThicknessRange.y,
      textureSample(
        pbr_iridescenceThicknessSampler,
        pbr_iridescenceThicknessSamplerSampler,
        iridescenceThicknessUV
      ).g
    );
    #endif

    var anisotropyStrength = clamp(pbrMaterial.anisotropyStrength, 0.0, 1.0);
    var anisotropyDirection = normalizeDirection(pbrMaterial.anisotropyDirection);
    #ifdef HAS_ANISOTROPYMAP
    if (pbrMaterial.anisotropyMapEnabled != 0) {
      let anisotropySample = textureSample(
        pbr_anisotropySampler,
        pbr_anisotropySamplerSampler,
        anisotropyUV
      ).rgb;
      anisotropyStrength *= anisotropySample.b;
      let mappedDirection = anisotropySample.rg * 2.0 - 1.0;
      if (length(mappedDirection) > 0.0001) {
        anisotropyDirection = normalize(mappedDirection);
      }
    }
    #endif
    anisotropyDirection = rotateDirection(anisotropyDirection, pbrMaterial.anisotropyRotation);
    var anisotropyTangent =
      normalize(tbn[0] * anisotropyDirection.x + tbn[1] * anisotropyDirection.y);
    if (length(anisotropyTangent) < 0.0001) {
      anisotropyTangent = normalize(tbn[0]);
    }
    let anisotropyViewAlignment = abs(dot(v, anisotropyTangent));
    perceptualRoughness = mix(
      perceptualRoughness,
      clamp(perceptualRoughness * (1.0 - 0.6 * anisotropyViewAlignment), c_MinRoughness, 1.0),
      anisotropyStrength
    );

    // Roughness is authored as perceptual roughness; as is convention,
    // convert to material roughness by squaring the perceptual roughness [2].
    let alphaRoughness = perceptualRoughness * perceptualRoughness;

    let dielectricF0 = getDielectricF0(pbrMaterial.ior);
    var dielectricSpecularF0 = min(
      vec3f(dielectricF0) * specularFactor * specularIntensity,
      vec3f(1.0)
    );
    let iridescenceTint = getIridescenceTint(iridescence, iridescenceThickness, NdotV);
    dielectricSpecularF0 = mix(
      dielectricSpecularF0,
      dielectricSpecularF0 * iridescenceTint,
      iridescence
    );
    var diffuseColor = baseColor.rgb * (vec3f(1.0) - dielectricSpecularF0);
    diffuseColor *= (1.0 - metallic) * (1.0 - transmission);
    var specularColor = mix(dielectricSpecularF0, baseColor.rgb, metallic);

    let baseLayerEnergy = 1.0 - clearcoatFactor * 0.25;
    diffuseColor *= baseLayerEnergy;
    specularColor *= baseLayerEnergy;

    // Compute reflectance.
    let reflectance = max(max(specularColor.r, specularColor.g), specularColor.b);

    // For typical incident reflectance range (between 4% to 100%) set the grazing
    // reflectance to 100% for typical fresnel effect.
    // For very low reflectance range on highly diffuse objects (below 4%),
    // incrementally reduce grazing reflectance to 0%.
    let reflectance90 = clamp(reflectance * 25.0, 0.0, 1.0);
    let specularEnvironmentR0 = specularColor;
    let specularEnvironmentR90 = vec3<f32>(1.0, 1.0, 1.0) * reflectance90;
    let reflection = -normalize(reflect(v, n));

    var pbrInfo = PBRInfo(
      0.0, // NdotL
      NdotV,
      0.0, // NdotH
      0.0, // LdotH
      0.0, // VdotH
      perceptualRoughness,
      metallic,
      specularEnvironmentR0,
      specularEnvironmentR90,
      alphaRoughness,
      diffuseColor,
      specularColor,
      n,
      v
    );

    #ifdef USE_LIGHTS
    // Apply ambient light
    PBRInfo_setAmbientLight(&pbrInfo);
    color += calculateMaterialLightColor(
      pbrInfo,
      lighting.ambientColor,
      clearcoatNormal,
      clearcoatFactor,
      clearcoatRoughness,
      sheenColor,
      sheenRoughness,
      anisotropyTangent,
      anisotropyStrength
    );

    // Apply directional light
    for (var i = 0; i < lighting.directionalLightCount; i++) {
      if (i < lighting.directionalLightCount) {
        PBRInfo_setDirectionalLight(&pbrInfo, lighting_getDirectionalLight(i).direction);
        color += calculateMaterialLightColor(
          pbrInfo,
          lighting_getDirectionalLight(i).color,
          clearcoatNormal,
          clearcoatFactor,
          clearcoatRoughness,
          sheenColor,
          sheenRoughness,
          anisotropyTangent,
          anisotropyStrength
        );
      }
    }

    // Apply point light
    for (var i = 0; i < lighting.pointLightCount; i++) {
      if (i < lighting.pointLightCount) {
        PBRInfo_setPointLight(&pbrInfo, lighting_getPointLight(i));
        let attenuation = getPointLightAttenuation(
          lighting_getPointLight(i),
          distance(lighting_getPointLight(i).position, fragmentInputs.pbr_vPosition)
        );
        color += calculateMaterialLightColor(
          pbrInfo,
          lighting_getPointLight(i).color / attenuation,
          clearcoatNormal,
          clearcoatFactor,
          clearcoatRoughness,
          sheenColor,
          sheenRoughness,
          anisotropyTangent,
          anisotropyStrength
        );
      }
    }

    for (var i = 0; i < lighting.spotLightCount; i++) {
      if (i < lighting.spotLightCount) {
        PBRInfo_setSpotLight(&pbrInfo, lighting_getSpotLight(i));
        let attenuation = getSpotLightAttenuation(lighting_getSpotLight(i), fragmentInputs.pbr_vPosition);
        color += calculateMaterialLightColor(
          pbrInfo,
          lighting_getSpotLight(i).color / attenuation,
          clearcoatNormal,
          clearcoatFactor,
          clearcoatRoughness,
          sheenColor,
          sheenRoughness,
          anisotropyTangent,
          anisotropyStrength
        );
      }
    }
    #endif

    // Calculate lighting contribution from image based lighting source (IBL)
    #ifdef USE_IBL
    if (pbrMaterial.IBLenabled != 0) {
      color += getIBLContribution(pbrInfo, n, reflection) *
        calculateAnisotropyBoost(pbrInfo, anisotropyTangent, anisotropyStrength);
      color += calculateClearcoatIBLContribution(
        pbrInfo,
        clearcoatNormal,
        -normalize(reflect(v, clearcoatNormal)),
        clearcoatFactor,
        clearcoatRoughness
      );
      color += sheenColor * pbrMaterial.scaleIBLAmbient.x * (1.0 - sheenRoughness) * 0.25;
    }
    #endif

    // Apply optional PBR terms for additional (optional) shading
    #ifdef HAS_OCCLUSIONMAP
    if (pbrMaterial.occlusionMapEnabled != 0) {
      let ao = textureSample(pbr_occlusionSampler, pbr_occlusionSamplerSampler, occlusionUV).r;
      color = mix(color, color * ao, pbrMaterial.occlusionStrength);
    }
    #endif

    var emissive = pbrMaterial.emissiveFactor;
    #ifdef HAS_EMISSIVEMAP
    if (pbrMaterial.emissiveMapEnabled != 0u) {
      emissive *= SRGBtoLINEAR(
        textureSample(pbr_emissiveSampler, pbr_emissiveSamplerSampler, emissiveUV)
      ).rgb;
    }
    #endif
    color += emissive * pbrMaterial.emissiveStrength;

    if (transmission > 0.0) {
      color = mix(color, color * getVolumeAttenuation(thickness), transmission);
    }

    // This section uses mix to override final color for reference app visualization
    // of various parameters in the lighting equation.
    #ifdef PBR_DEBUG
    // TODO: Figure out how to debug multiple lights

    // color = mix(color, F, pbr_scaleFGDSpec.x);
    // color = mix(color, vec3(G), pbr_scaleFGDSpec.y);
    // color = mix(color, vec3(D), pbr_scaleFGDSpec.z);
    // color = mix(color, specContrib, pbr_scaleFGDSpec.w);

    // color = mix(color, diffuseContrib, pbr_scaleDiffBaseMR.x);
    color = mix(color, baseColor.rgb, pbrMaterial.scaleDiffBaseMR.y);
    color = mix(color, vec3<f32>(metallic), pbrMaterial.scaleDiffBaseMR.z);
    color = mix(color, vec3<f32>(perceptualRoughness), pbrMaterial.scaleDiffBaseMR.w);
    #endif
  }

  let alpha = clamp(baseColor.a * (1.0 - transmission), 0.0, 1.0);
  return vec4<f32>(pow(color, vec3<f32>(1.0 / 2.2)), alpha);
}
`;var Xs=`layout(std140) uniform pbrProjectionUniforms {
  mat4 modelViewProjectionMatrix;
  mat4 modelMatrix;
  mat4 normalMatrix;
  vec3 camera;
} pbrProjection;
`,Mf=`struct pbrProjectionUniforms {
  modelViewProjectionMatrix: mat4x4<f32>,
  modelMatrix: mat4x4<f32>,
  normalMatrix: mat4x4<f32>,
  camera: vec3<f32>
};

@group(0) @binding(auto) var<uniform> pbrProjection: pbrProjectionUniforms;
`,Zs={name:"pbrProjection",bindingLayout:[{name:"pbrProjection",group:0}],source:Mf,vs:Xs,fs:Xs,getUniforms:r=>r,uniformTypes:{modelViewProjectionMatrix:"mat4x4<f32>",modelMatrix:"mat4x4<f32>",normalMatrix:"mat4x4<f32>",camera:"vec3<f32>"}};var Pf={props:{},uniforms:{},defaultUniforms:{unlit:!1,baseColorMapEnabled:!1,baseColorFactor:[1,1,1,1],normalMapEnabled:!1,normalScale:1,emissiveMapEnabled:!1,emissiveFactor:[0,0,0],metallicRoughnessValues:[1,1],metallicRoughnessMapEnabled:!1,occlusionMapEnabled:!1,occlusionStrength:1,alphaCutoffEnabled:!1,alphaCutoff:.5,IBLenabled:!1,scaleIBLAmbient:[1,1],scaleDiffBaseMR:[0,0,0,0],scaleFGDSpec:[0,0,0,0],specularColorFactor:[1,1,1],specularIntensityFactor:1,specularColorMapEnabled:!1,specularIntensityMapEnabled:!1,ior:1.5,transmissionFactor:0,transmissionMapEnabled:!1,thicknessFactor:0,attenuationDistance:1e9,attenuationColor:[1,1,1],clearcoatFactor:0,clearcoatRoughnessFactor:0,clearcoatMapEnabled:!1,clearcoatRoughnessMapEnabled:!1,sheenColorFactor:[0,0,0],sheenRoughnessFactor:0,sheenColorMapEnabled:!1,sheenRoughnessMapEnabled:!1,iridescenceFactor:0,iridescenceIor:1.3,iridescenceThicknessRange:[100,400],iridescenceMapEnabled:!1,anisotropyStrength:0,anisotropyRotation:0,anisotropyDirection:[1,0],anisotropyMapEnabled:!1,emissiveStrength:1,baseColorUVSet:0,baseColorUVTransform:[1,0,0,0,1,0,0,0,1],metallicRoughnessUVSet:0,metallicRoughnessUVTransform:[1,0,0,0,1,0,0,0,1],normalUVSet:0,normalUVTransform:[1,0,0,0,1,0,0,0,1],occlusionUVSet:0,occlusionUVTransform:[1,0,0,0,1,0,0,0,1],emissiveUVSet:0,emissiveUVTransform:[1,0,0,0,1,0,0,0,1],specularColorUVSet:0,specularColorUVTransform:[1,0,0,0,1,0,0,0,1],specularIntensityUVSet:0,specularIntensityUVTransform:[1,0,0,0,1,0,0,0,1],transmissionUVSet:0,transmissionUVTransform:[1,0,0,0,1,0,0,0,1],thicknessUVSet:0,thicknessUVTransform:[1,0,0,0,1,0,0,0,1],clearcoatUVSet:0,clearcoatUVTransform:[1,0,0,0,1,0,0,0,1],clearcoatRoughnessUVSet:0,clearcoatRoughnessUVTransform:[1,0,0,0,1,0,0,0,1],clearcoatNormalUVSet:0,clearcoatNormalUVTransform:[1,0,0,0,1,0,0,0,1],sheenColorUVSet:0,sheenColorUVTransform:[1,0,0,0,1,0,0,0,1],sheenRoughnessUVSet:0,sheenRoughnessUVTransform:[1,0,0,0,1,0,0,0,1],iridescenceUVSet:0,iridescenceUVTransform:[1,0,0,0,1,0,0,0,1],iridescenceThicknessUVSet:0,iridescenceThicknessUVTransform:[1,0,0,0,1,0,0,0,1],anisotropyUVSet:0,anisotropyUVTransform:[1,0,0,0,1,0,0,0,1]},name:"pbrMaterial",firstBindingSlot:0,bindingLayout:[{name:"pbrMaterial",group:3},{name:"pbr_baseColorSampler",group:3},{name:"pbr_normalSampler",group:3},{name:"pbr_emissiveSampler",group:3},{name:"pbr_metallicRoughnessSampler",group:3},{name:"pbr_occlusionSampler",group:3},{name:"pbr_specularColorSampler",group:3},{name:"pbr_specularIntensitySampler",group:3},{name:"pbr_transmissionSampler",group:3},{name:"pbr_thicknessSampler",group:3},{name:"pbr_clearcoatSampler",group:3},{name:"pbr_clearcoatRoughnessSampler",group:3},{name:"pbr_clearcoatNormalSampler",group:3},{name:"pbr_sheenColorSampler",group:3},{name:"pbr_sheenRoughnessSampler",group:3},{name:"pbr_iridescenceSampler",group:3},{name:"pbr_iridescenceThicknessSampler",group:3},{name:"pbr_anisotropySampler",group:3}],dependencies:[ct,Ws,Zs],source:qs,vs:$s,fs:Ys,defines:{LIGHTING_FRAGMENT:!0,HAS_NORMALMAP:!1,HAS_EMISSIVEMAP:!1,HAS_OCCLUSIONMAP:!1,HAS_BASECOLORMAP:!1,HAS_METALROUGHNESSMAP:!1,HAS_SPECULARCOLORMAP:!1,HAS_SPECULARINTENSITYMAP:!1,HAS_TRANSMISSIONMAP:!1,HAS_THICKNESSMAP:!1,HAS_CLEARCOATMAP:!1,HAS_CLEARCOATROUGHNESSMAP:!1,HAS_CLEARCOATNORMALMAP:!1,HAS_SHEENCOLORMAP:!1,HAS_SHEENROUGHNESSMAP:!1,HAS_IRIDESCENCEMAP:!1,HAS_IRIDESCENCETHICKNESSMAP:!1,HAS_ANISOTROPYMAP:!1,USE_MATERIAL_EXTENSIONS:!1,ALPHA_CUTOFF:!1,USE_IBL:!1,PBR_DEBUG:!1},getUniforms:r=>r,uniformTypes:{unlit:"i32",baseColorMapEnabled:"i32",baseColorFactor:"vec4<f32>",normalMapEnabled:"i32",normalScale:"f32",emissiveMapEnabled:"i32",emissiveFactor:"vec3<f32>",metallicRoughnessValues:"vec2<f32>",metallicRoughnessMapEnabled:"i32",occlusionMapEnabled:"i32",occlusionStrength:"f32",alphaCutoffEnabled:"i32",alphaCutoff:"f32",specularColorFactor:"vec3<f32>",specularIntensityFactor:"f32",specularColorMapEnabled:"i32",specularIntensityMapEnabled:"i32",ior:"f32",transmissionFactor:"f32",transmissionMapEnabled:"i32",thicknessFactor:"f32",attenuationDistance:"f32",attenuationColor:"vec3<f32>",clearcoatFactor:"f32",clearcoatRoughnessFactor:"f32",clearcoatMapEnabled:"i32",clearcoatRoughnessMapEnabled:"i32",sheenColorFactor:"vec3<f32>",sheenRoughnessFactor:"f32",sheenColorMapEnabled:"i32",sheenRoughnessMapEnabled:"i32",iridescenceFactor:"f32",iridescenceIor:"f32",iridescenceThicknessRange:"vec2<f32>",iridescenceMapEnabled:"i32",anisotropyStrength:"f32",anisotropyRotation:"f32",anisotropyDirection:"vec2<f32>",anisotropyMapEnabled:"i32",emissiveStrength:"f32",IBLenabled:"i32",scaleIBLAmbient:"vec2<f32>",scaleDiffBaseMR:"vec4<f32>",scaleFGDSpec:"vec4<f32>",baseColorUVSet:"i32",baseColorUVTransform:"mat3x3<f32>",metallicRoughnessUVSet:"i32",metallicRoughnessUVTransform:"mat3x3<f32>",normalUVSet:"i32",normalUVTransform:"mat3x3<f32>",occlusionUVSet:"i32",occlusionUVTransform:"mat3x3<f32>",emissiveUVSet:"i32",emissiveUVTransform:"mat3x3<f32>",specularColorUVSet:"i32",specularColorUVTransform:"mat3x3<f32>",specularIntensityUVSet:"i32",specularIntensityUVTransform:"mat3x3<f32>",transmissionUVSet:"i32",transmissionUVTransform:"mat3x3<f32>",thicknessUVSet:"i32",thicknessUVTransform:"mat3x3<f32>",clearcoatUVSet:"i32",clearcoatUVTransform:"mat3x3<f32>",clearcoatRoughnessUVSet:"i32",clearcoatRoughnessUVTransform:"mat3x3<f32>",clearcoatNormalUVSet:"i32",clearcoatNormalUVTransform:"mat3x3<f32>",sheenColorUVSet:"i32",sheenColorUVTransform:"mat3x3<f32>",sheenRoughnessUVSet:"i32",sheenRoughnessUVTransform:"mat3x3<f32>",iridescenceUVSet:"i32",iridescenceUVTransform:"mat3x3<f32>",iridescenceThicknessUVSet:"i32",iridescenceThicknessUVTransform:"mat3x3<f32>",anisotropyUVSet:"i32",anisotropyUVTransform:"mat3x3<f32>"}};var dr=class{constructor(e){m(this,"id");m(this,"userData",{});m(this,"topology");m(this,"bufferLayout",[]);m(this,"vertexCount");m(this,"indices");m(this,"attributes");if(this.id=e.id||X("geometry"),this.topology=e.topology,this.indices=e.indices||null,this.attributes=e.attributes,this.vertexCount=e.vertexCount,this.bufferLayout=e.bufferLayout||[],this.indices&&!(this.indices.usage&U.INDEX))throw new Error("Index buffer must have INDEX usage")}destroy(){this.indices?.destroy();for(let e of Object.values(this.attributes))e.destroy()}getVertexCount(){return this.vertexCount}getAttributes(){return this.attributes}getIndexes(){return this.indices||null}_calculateVertexCount(e){return e.byteLength/12}};function Ks(r,e){if(e instanceof dr)return e;let t=Tf(r,e),{attributes:i,bufferLayout:o}=Af(r,e);return new dr({topology:e.topology||"triangle-list",bufferLayout:o,vertexCount:e.vertexCount,indices:t,attributes:i})}function Tf(r,e){if(!e.indices)return;let t=e.indices.value;return r.createBuffer({usage:U.INDEX,data:t})}function Af(r,e){let t=[],i={};for(let[n,s]of Object.entries(e.attributes)){let a=n;switch(n){case"POSITION":a="positions";break;case"NORMAL":a="normals";break;case"TEXCOORD_0":a="texCoords";break;case"TEXCOORD_1":a="texCoords1";break;case"COLOR_0":a="colors";break}if(s){i[a]=r.createBuffer({data:s.value,id:`${n}-buffer`});let{value:l,size:c,normalized:f}=s;if(c===void 0)throw new Error(`Attribute ${n} is missing a size`);t.push({name:a,format:Rn.getVertexFormatFromAttribute(l,c,f)})}}let o=e._calculateVertexCount(e.attributes,e.indices);return{attributes:i,bufferLayout:t,vertexCount:o}}function Js(r,e){let t={},i="Values";if(r.attributes.length===0&&!r.varyings?.length)return{"No attributes or varyings":{[i]:"N/A"}};for(let o of r.attributes)if(o){let n=`${o.location} ${o.name}: ${o.type}`;t[`in ${n}`]={[i]:o.stepMode||"vertex"}}for(let o of r.varyings||[]){let n=`${o.location} ${o.name}`;t[`out ${n}`]={[i]:JSON.stringify(o)}}return t}var mr="__debugFramebufferState";function ea(r,e,t){if(r.device.type!=="webgl")return;let i=Rf(r.device);if(!i.flushing){if(Of(r)){Cf(r,t,i);return}e&&If(e)&&e.handle!==null&&(i.queuedFramebuffers.includes(e)||i.queuedFramebuffers.push(e))}}function Cf(r,e,t){if(t.queuedFramebuffers.length===0)return;let i=r.device,{gl:o}=i,n=o.getParameter(36010),s=o.getParameter(36006),[a,l]=r.device.getDefaultCanvasContext().getDrawingBufferSize(),c=Qs(e.top,8),f=Qs(e.left,8);t.flushing=!0;try{for(let u of t.queuedFramebuffers){let[h,p,d,g,b]=Lf({framebuffer:u,targetWidth:a,targetHeight:l,topPx:c,leftPx:f,minimap:e.minimap});o.bindFramebuffer(36008,u.handle),o.bindFramebuffer(36009,null),o.blitFramebuffer(0,0,u.width,u.height,h,p,d,g,16384,9728),c+=b+8}}finally{o.bindFramebuffer(36008,n),o.bindFramebuffer(36009,s),t.flushing=!1}}function Lf(r){let{framebuffer:e,targetWidth:t,targetHeight:i,topPx:o,leftPx:n,minimap:s}=r,a=s?Math.max(Math.floor(t/4),1):t,l=s?Math.max(Math.floor(i/4),1):i,c=Math.min(a/e.width,l/e.height),f=Math.max(Math.floor(e.width*c),1),u=Math.max(Math.floor(e.height*c),1),h=n,p=Math.max(i-o-u,0),d=h+f,g=p+u;return[h,p,d,g,u]}function Rf(r){var e;return(e=r.userData)[mr]||(e[mr]={flushing:!1,queuedFramebuffers:[]}),r.userData[mr]}function If(r){return"colorAttachments"in r}function Of(r){let e=r.props.framebuffer;return!e||e.handle===null}function Qs(r,e){if(!r)return e;let t=Number.parseInt(r,10);return Number.isFinite(t)?t:e}function gr(r,e,t){if(r===e)return!0;if(!t||!r||!e)return!1;if(Array.isArray(r)){if(!Array.isArray(e)||r.length!==e.length)return!1;for(let i=0;i<r.length;i++)if(!gr(r[i],e[i],t-1))return!1;return!0}if(Array.isArray(e))return!1;if(typeof r=="object"&&typeof e=="object"){let i=Object.keys(r),o=Object.keys(e);if(i.length!==o.length)return!1;for(let n of i)if(!e.hasOwnProperty(n)||!gr(r[n],e[n],t-1))return!1;return!0}return!1}var ft=class{constructor(e){m(this,"bufferLayouts");this.bufferLayouts=e}getBufferLayout(e){return this.bufferLayouts.find(t=>t.name===e)||null}getAttributeNamesForBuffer(e){return e.attributes?e.attributes?.map(t=>t.attribute):[e.name]}mergeBufferLayouts(e,t){let i=[...e];for(let o of t){let n=i.findIndex(s=>s.name===o.name);n<0?i.push(o):i[n]=o}return i}getBufferIndex(e){let t=this.bufferLayouts.findIndex(i=>i.name===e);return t===-1&&L.warn(`BufferLayout: Missing buffer for "${e}".`)(),t}};function ta(r,e){let t=1/0;for(let i of r){let o=e[i];o!==void 0&&(t=Math.min(t,o))}return t}function ia(r,e){let t=Object.fromEntries(r.attributes.map(o=>[o.name,o.location])),i=e.slice();return i.sort((o,n)=>{let s=o.attributes?o.attributes.map(f=>f.attribute):[o.name],a=n.attributes?n.attributes.map(f=>f.attribute):[n.name],l=ta(s,t),c=ta(a,t);return l-c}),i}function Oo(r,e){if(!r||!e.some(i=>i.bindingLayout?.length))return r;let t={...r,bindings:r.bindings.map(i=>({...i}))};"attributes"in(r||{})&&(t.attributes=r?.attributes||[]);for(let i of e)for(let o of i.bindingLayout||[])for(let n of Nf(o.name)){let s=t.bindings.find(a=>a.name===n);s?.group===0&&(s.group=o.group)}return t}function _r(r){return!!(r.uniformTypes&&!Uf(r.uniformTypes))}function Nf(r){let e=new Set([r,`${r}Uniforms`]);return r.endsWith("Uniforms")||e.add(`${r}Sampler`),[...e]}function Uf(r){for(let e in r)return!1;return!0}function ra(r){return ArrayBuffer.isView(r)&&!(r instanceof DataView)}function oa(r){return Array.isArray(r)?r.length===0||typeof r[0]=="number":!1}function No(r){return ra(r)||oa(r)}function Df(r){return No(r)||typeof r=="number"||typeof r=="boolean"}function na(r,e={}){let t={bindings:{},uniforms:{}};return Object.keys(r).forEach(i=>{let o=r[i];Object.prototype.hasOwnProperty.call(e,i)||Df(o)?t.uniforms[i]=o:t.bindings[i]=o}),t}var Me=class{constructor(e,t){m(this,"options",{disableWarnings:!1});m(this,"modules");m(this,"moduleUniforms");m(this,"moduleBindings");Object.assign(this.options,t);let i=st(Object.values(e).filter(kf));for(let o of i)e[o.name]=o;L.log(1,"Creating ShaderInputs with modules",Object.keys(e))(),this.modules=e,this.moduleUniforms={},this.moduleBindings={};for(let[o,n]of Object.entries(e))n&&(this._addModule(n),n.name&&o!==n.name&&!this.options.disableWarnings&&L.warn(`Module name: ${o} vs ${n.name}`)())}destroy(){}setProps(e){for(let t of Object.keys(e)){let i=t,o=e[i]||{},n=this.modules[i];if(!n)this.options.disableWarnings||L.warn(`Module ${t} not found`)();else{let s=this.moduleUniforms[i],a=this.moduleBindings[i],l=n.getUniforms?.(o,s)||o,{uniforms:c,bindings:f}=na(l,n.uniformTypes);this.moduleUniforms[i]=sa(s,c,n.uniformTypes),this.moduleBindings[i]={...a,...f}}}}getModules(){return Object.values(this.modules)}getUniformValues(){return this.moduleUniforms}getBindingValues(){let e={};for(let t of Object.values(this.moduleBindings))Object.assign(e,t);return e}getDebugTable(){let e={};for(let[t,i]of Object.entries(this.moduleUniforms))for(let[o,n]of Object.entries(i))e[`${t}.${o}`]={type:this.modules[t].uniformTypes?.[o],value:String(n)};return e}_addModule(e){let t=e.name;this.moduleUniforms[t]=sa({},e.defaultUniforms||{},e.uniformTypes),this.moduleBindings[t]={}}};function sa(r={},e={},t={}){let i={...r};for(let[o,n]of Object.entries(e))n!==void 0&&(i[o]=Uo(r[o],n,t[o]));return i}function Uo(r,e,t){if(!t||typeof t=="string")return Wt(e);if(Array.isArray(t)){if(Do(e)||!Array.isArray(e))return Wt(e);let s=Array.isArray(r)&&!Do(r)?[...r]:[],a=s.slice();for(let l=0;l<e.length;l++){let c=e[l];c!==void 0&&(a[l]=Uo(s[l],c,t[0]))}return a}if(!ko(e))return Wt(e);let i=t,o=ko(r)?r:{},n={...o};for(let[s,a]of Object.entries(e))a!==void 0&&(n[s]=Uo(o[s],a,i[s]));return n}function Wt(r){return ArrayBuffer.isView(r)?Array.prototype.slice.call(r):Array.isArray(r)?Do(r)?r.slice():r.map(t=>t===void 0?void 0:Wt(t)):ko(r)?Object.fromEntries(Object.entries(r).map(([e,t])=>[e,t===void 0?void 0:Wt(t)])):r}function Do(r){return ArrayBuffer.isView(r)||Array.isArray(r)&&(r.length===0||typeof r[0]=="number")}function ko(r){return!!r&&typeof r=="object"&&!Array.isArray(r)&&!ArrayBuffer.isView(r)}function kf(r){return!!r?.dependencies}var Bo={"+X":0,"-X":1,"+Y":2,"-Y":3,"+Z":4,"-Z":5};function $t(r){return r?Array.isArray(r)?r[0]??null:r:null}function aa(r){let{dimension:e,data:t}=r;if(!t)return null;switch(e){case"1d":{let i=$t(t);if(!i)return null;let{width:o}=Yt(i);return{width:o,height:1}}case"2d":{let i=$t(t);return i?Yt(i):null}case"3d":case"2d-array":{if(!Array.isArray(t)||t.length===0)return null;let i=$t(t[0]);return i?Yt(i):null}case"cube":{let i=Object.keys(t)[0]??null;if(!i)return null;let o=t[i],n=$t(o);return n?Yt(n):null}case"cube-array":{if(!Array.isArray(t)||t.length===0)return null;let i=t[0],o=Object.keys(i)[0]??null;if(!o)return null;let n=$t(i[o]);return n?Yt(n):null}default:return null}}function Yt(r){if(to(r))return In(r);if(typeof r=="object"&&"width"in r&&"height"in r)return{width:r.width,height:r.height};throw new Error("Unsupported mip-level data")}function Bf(r){return typeof r=="object"&&r!==null&&"data"in r&&"width"in r&&"height"in r}function Vf(r){return ArrayBuffer.isView(r)}function Vo(r){let{textureFormat:e,format:t}=r;if(e&&t&&e!==t)throw new Error(`Conflicting texture formats "${e}" and "${t}" provided for the same mip level`);return e??t}function la(r){let e=Bo[r];if(e===void 0)throw new Error(`Invalid cube face: ${r}`);return e}function Ff(r,e){return 6*r+la(e)}function Fo(r){throw new Error("setTexture1DData not supported in WebGL.")}function zf(r){return Array.isArray(r)?r:[r]}function Ge(r,e,t,i){let o=zf(e),n=r,s=[];for(let a=0;a<o.length;a++){let l=o[a];if(to(l))s.push({type:"external-image",image:l,z:n,mipLevel:a});else if(Bf(l))s.push({type:"texture-data",data:l,textureFormat:Vo(l),z:n,mipLevel:a});else if(Vf(l)&&t)s.push({type:"texture-data",data:{data:l,width:Math.max(1,t.width>>a),height:Math.max(1,t.height>>a),...i?{format:i}:{}},textureFormat:i,z:n,mipLevel:a});else throw new Error("Unsupported 2D mip-level payload")}return s}function zo(r){let e=[];for(let t=0;t<r.length;t++)e.push(...Ge(t,r[t]));return e}function jo(r){let e=[];for(let t=0;t<r.length;t++)e.push(...Ge(t,r[t]));return e}function Go(r){let e=[];for(let[t,i]of Object.entries(r)){let o=la(t);e.push(...Ge(o,i))}return e}function Ho(r){let e=[];return r.forEach((t,i)=>{for(let[o,n]of Object.entries(t)){let s=Ff(i,o);e.push(...Ge(s,n))}}),e}var br=class br{constructor(e,t){m(this,"device");m(this,"id");m(this,"props");m(this,"_texture",null);m(this,"_sampler",null);m(this,"_view",null);m(this,"ready");m(this,"isReady",!1);m(this,"destroyed",!1);m(this,"resolveReady",()=>{});m(this,"rejectReady",()=>{});this.device=e;let i=X("dynamic-texture"),o=t;this.props={...br.defaultProps,id:i,...t,data:null},this.id=this.props.id,this.ready=new Promise((n,s)=>{this.resolveReady=n,this.rejectReady=s}),this.initAsync(o)}get texture(){if(!this._texture)throw new Error("Texture not initialized yet");return this._texture}get sampler(){if(!this._sampler)throw new Error("Sampler not initialized yet");return this._sampler}get view(){if(!this._view)throw new Error("View not initialized yet");return this._view}get[Symbol.toStringTag](){return"DynamicTexture"}toString(){let e=this._texture?.width??this.props.width??"?",t=this._texture?.height??this.props.height??"?";return`DynamicTexture:"${this.id}":${e}x${t}px:(${this.isReady?"ready":"loading..."})`}async initAsync(e){try{let t=await this._loadAllData(e);this._checkNotDestroyed();let i=t.data?jf({...t,width:e.width,height:e.height,format:e.format}):[],o="format"in e&&e.format!==void 0,n="usage"in e&&e.usage!==void 0,a=(()=>{if(this.props.width&&this.props.height)return{width:this.props.width,height:this.props.height};let g=aa(t);return g||{width:this.props.width||1,height:this.props.height||1}})();if(!a||a.width<=0||a.height<=0)throw new Error(`${this} size could not be determined or was zero`);let l=Gf(this.device,i,a,{format:o?e.format:void 0}),c=l.format??this.props.format,f={...this.props,...a,format:c,mipLevels:1,data:void 0};this.device.isTextureFormatCompressed(c)&&!n&&(f.usage=k.SAMPLE|k.COPY_DST);let u=this.props.mipmaps&&!l.hasExplicitMipChain&&!this.device.isTextureFormatCompressed(c);if(this.device.type==="webgpu"&&u){let g=this.props.dimension==="3d"?k.SAMPLE|k.STORAGE|k.COPY_DST|k.COPY_SRC:k.SAMPLE|k.RENDER|k.COPY_DST|k.COPY_SRC;f.usage|=g}let h=this.device.getMipLevelCount(f.width,f.height),p=l.hasExplicitMipChain?l.mipLevels:this.props.mipLevels==="auto"?h:Math.max(1,Math.min(h,this.props.mipLevels??1)),d={...f,mipLevels:p};this._texture=this.device.createTexture(d),this._sampler=this.texture.sampler,this._view=this.texture.view,l.subresources.length&&this._setTextureSubresources(l.subresources),this.props.mipmaps&&!l.hasExplicitMipChain&&!u&&L.warn(`${this} skipping auto-generated mipmaps for compressed texture format`)(),u&&this.generateMipmaps(),this.isReady=!0,this.resolveReady(this.texture),L.info(0,`${this} created`)()}catch(t){let i=t instanceof Error?t:new Error(String(t));this.rejectReady(i)}}destroy(){this._texture&&(this._texture.destroy(),this._texture=null,this._sampler=null,this._view=null),this.destroyed=!0}generateMipmaps(){this.device.type==="webgl"?this.texture.generateMipmapsWebGL():this.device.type==="webgpu"?this.device.generateMipmapsWebGPU(this.texture):L.warn(`${this} mipmaps not supported on ${this.device.type}`)}setSampler(e={}){this._checkReady();let t=e instanceof et?e:this.device.createSampler(e);this.texture.setSampler(t),this._sampler=t}async readBuffer(e={}){this.isReady||await this.ready;let t=e.width??this.texture.width,i=e.height??this.texture.height,o=e.depthOrArrayLayers??this.texture.depth,n=this.texture.computeMemoryLayout({width:t,height:i,depthOrArrayLayers:o}),s=this.device.createBuffer({byteLength:n.byteLength,usage:U.COPY_DST|U.MAP_READ});this.texture.readBuffer({...e,width:t,height:i,depthOrArrayLayers:o},s);let a=this.device.createFence();return await a.signaled,a.destroy(),s}async readAsync(e={}){this.isReady||await this.ready;let t=e.width??this.texture.width,i=e.height??this.texture.height,o=e.depthOrArrayLayers??this.texture.depth,n=this.texture.computeMemoryLayout({width:t,height:i,depthOrArrayLayers:o}),s=await this.readBuffer(e),a=await s.readAsync(0,n.byteLength);return s.destroy(),a.buffer}resize(e){if(this._checkReady(),e.width===this.texture.width&&e.height===this.texture.height)return!1;let t=this.texture;return this._texture=t.clone(e),this._sampler=this.texture.sampler,this._view=this.texture.view,t.destroy(),L.info(`${this} resized`),!0}getCubeFaceIndex(e){let t=Bo[e];if(t===void 0)throw new Error(`Invalid cube face: ${e}`);return t}getCubeArrayFaceIndex(e,t){return 6*e+this.getCubeFaceIndex(t)}setTexture1DData(e){if(this._checkReady(),this.texture.props.dimension!=="1d")throw new Error(`${this} is not 1d`);let t=Fo(e);this._setTextureSubresources(t)}setTexture2DData(e,t=0){if(this._checkReady(),this.texture.props.dimension!=="2d")throw new Error(`${this} is not 2d`);let i=Ge(t,e);this._setTextureSubresources(i)}setTexture3DData(e){if(this.texture.props.dimension!=="3d")throw new Error(`${this} is not 3d`);let t=zo(e);this._setTextureSubresources(t)}setTextureArrayData(e){if(this.texture.props.dimension!=="2d-array")throw new Error(`${this} is not 2d-array`);let t=jo(e);this._setTextureSubresources(t)}setTextureCubeData(e){if(this.texture.props.dimension!=="cube")throw new Error(`${this} is not cube`);let t=Go(e);this._setTextureSubresources(t)}setTextureCubeArrayData(e){if(this.texture.props.dimension!=="cube-array")throw new Error(`${this} is not cube-array`);let t=Ho(e);this._setTextureSubresources(t)}_setTextureSubresources(e){for(let t of e){let{z:i,mipLevel:o}=t;switch(t.type){case"external-image":let{image:n,flipY:s}=t;this.texture.copyExternalImage({image:n,z:i,mipLevel:o,flipY:s});break;case"texture-data":let{data:a,textureFormat:l}=t;if(l&&l!==this.texture.format)throw new Error(`${this} mip level ${o} uses format "${l}" but texture format is "${this.texture.format}"`);this.texture.writeData(a.data,{x:0,y:0,z:i,width:a.width,height:a.height,depthOrArrayLayers:1,mipLevel:o});break;default:throw new Error("Unsupported 2D mip-level payload")}}}async _loadAllData(e){let t=await Wo(e.data);return{dimension:e.dimension??"2d",data:t??null}}_checkNotDestroyed(){this.destroyed&&L.warn(`${this} already destroyed`)}_checkReady(){this.isReady||L.warn(`${this} Cannot perform this operation before ready`)}};m(br,"defaultProps",{...k.defaultProps,dimension:"2d",data:null,mipmaps:!1});var ie=br;function jf(r){if(!r.data)return[];let e=r.width&&r.height?{width:r.width,height:r.height}:void 0,t="format"in r?r.format:void 0;switch(r.dimension){case"1d":return Fo(r.data);case"2d":return Ge(0,r.data,e,t);case"3d":return zo(r.data);case"2d-array":return jo(r.data);case"cube":return Go(r.data);case"cube-array":return Ho(r.data);default:throw new Error(`Unhandled dimension ${r.dimension}`)}}function Gf(r,e,t,i){if(e.length===0)return{subresources:e,mipLevels:1,format:i.format,hasExplicitMipChain:!1};let o=new Map;for(let f of e){let u=o.get(f.z)??[];u.push(f),o.set(f.z,u)}let n=e.some(f=>f.mipLevel>0),s=i.format,a=Number.POSITIVE_INFINITY,l=[];for(let[f,u]of o){let h=[...u].sort((y,_)=>y.mipLevel-_.mipLevel),p=h[0];if(!p||p.mipLevel!==0)throw new Error(`DynamicTexture: slice ${f} is missing mip level 0`);let d=fa(r,p);if(d.width!==t.width||d.height!==t.height)throw new Error(`DynamicTexture: slice ${f} base level dimensions ${d.width}x${d.height} do not match expected ${t.width}x${t.height}`);let g=ca(p);if(g){if(s&&s!==g)throw new Error(`DynamicTexture: slice ${f} base level format "${g}" does not match texture format "${s}"`);s=g}let b=s&&r.isTextureFormatCompressed(s)?Hf(r,d.width,d.height,s):r.getMipLevelCount(d.width,d.height),v=0;for(let y=0;y<h.length;y++){let _=h[y];if(!_||_.mipLevel!==y||y>=b)break;let S=fa(r,_),P=Math.max(1,d.width>>y),x=Math.max(1,d.height>>y);if(S.width!==P||S.height!==x)break;let E=ca(_);if(E&&(s||(s=E),E!==s))break;v++,l.push(_)}a=Math.min(a,v)}let c=Number.isFinite(a)?Math.max(1,a):1;return{subresources:l.filter(f=>f.mipLevel<c),mipLevels:c,format:s,hasExplicitMipChain:n}}function ca(r){if(r.type==="texture-data")return r.textureFormat??Vo(r.data)}function fa(r,e){switch(e.type){case"external-image":return r.getExternalImageSize(e.image);case"texture-data":return{width:e.data.width,height:e.data.height};default:throw new Error("Unsupported texture subresource")}}function Hf(r,e,t,i){let{blockWidth:o=1,blockHeight:n=1}=r.getTextureFormatInfo(i),s=1;for(let a=1;;a++){let l=Math.max(1,e>>a),c=Math.max(1,t>>a);if(l<o||c<n)break;s++}return s}async function Wo(r){if(r=await r,Array.isArray(r))return await Promise.all(r.map(Wo));if(r&&typeof r=="object"&&r.constructor===Object){let e=r,t=await Promise.all(Object.values(e).map(Wo)),i=Object.keys(e),o={};for(let n=0;n<i.length;n++)o[i[n]]=t[n];return o}return r}var Pe=2,Wf=1e4,ua="render pipeline initialization failed",vr=class vr{constructor(e,t){m(this,"device");m(this,"id");m(this,"source");m(this,"vs");m(this,"fs");m(this,"pipelineFactory");m(this,"shaderFactory");m(this,"userData",{});m(this,"parameters");m(this,"topology");m(this,"bufferLayout");m(this,"isInstanced");m(this,"instanceCount",0);m(this,"vertexCount");m(this,"indexBuffer",null);m(this,"bufferAttributes",{});m(this,"constantAttributes",{});m(this,"bindings",{});m(this,"vertexArray");m(this,"transformFeedback",null);m(this,"pipeline");m(this,"shaderInputs");m(this,"material",null);m(this,"_uniformStore");m(this,"_attributeInfos",{});m(this,"_gpuGeometry",null);m(this,"props");m(this,"_pipelineNeedsUpdate","newly created");m(this,"_needsRedraw","initializing");m(this,"_destroyed",!1);m(this,"_lastDrawTimestamp",-1);m(this,"_bindingTable",[]);m(this,"_lastLogTime",0);m(this,"_logOpen",!1);m(this,"_drawCount",0);this.props={...vr.defaultProps,...t},t=this.props,this.id=t.id||X("model"),this.device=e,Object.assign(this.userData,t.userData),this.material=t.material||null;let i=Object.fromEntries(this.props.modules?.map(l=>[l.name,l])||[]),o=t.shaderInputs||new Me(i,{disableWarnings:this.props.disableWarnings});this.setShaderInputs(o);let n=$f(e),s=(this.props.modules?.length>0?this.props.modules:this.shaderInputs?.getModules())||[];if(this.props.shaderLayout=Oo(this.props.shaderLayout,s)||null,this.device.type==="webgpu"&&this.props.source){let{source:l,getUniforms:c,bindingTable:f}=this.props.shaderAssembler.assembleWGSLShader({platformInfo:n,...this.props,modules:s});this.source=l,this._getModuleUniforms=c,this._bindingTable=f;let u=e.getShaderLayout?.(this.source);this.props.shaderLayout=Oo(this.props.shaderLayout||u||null,s)||null}else{let{vs:l,fs:c,getUniforms:f}=this.props.shaderAssembler.assembleGLSLShaderPair({platformInfo:n,...this.props,modules:s});this.vs=l,this.fs=c,this._getModuleUniforms=f,this._bindingTable=[]}this.vertexCount=this.props.vertexCount,this.instanceCount=this.props.instanceCount,this.topology=this.props.topology,this.bufferLayout=this.props.bufferLayout,this.parameters=this.props.parameters,t.geometry&&this.setGeometry(t.geometry),this.pipelineFactory=t.pipelineFactory||Nn.getDefaultPipelineFactory(this.device),this.shaderFactory=t.shaderFactory||Un.getDefaultShaderFactory(this.device),this.pipeline=this._updatePipeline(),this.vertexArray=e.createVertexArray({shaderLayout:this.pipeline.shaderLayout,bufferLayout:this.pipeline.bufferLayout}),this._gpuGeometry&&this._setGeometryAttributes(this._gpuGeometry),"isInstanced"in t&&(this.isInstanced=t.isInstanced),t.instanceCount&&this.setInstanceCount(t.instanceCount),t.vertexCount&&this.setVertexCount(t.vertexCount),t.indexBuffer&&this.setIndexBuffer(t.indexBuffer),t.attributes&&this.setAttributes(t.attributes),t.constantAttributes&&this.setConstantAttributes(t.constantAttributes),t.bindings&&this.setBindings(t.bindings),t.transformFeedback&&(this.transformFeedback=t.transformFeedback)}get[Symbol.toStringTag](){return"Model"}toString(){return`Model(${this.id})`}destroy(){this._destroyed||(this.pipelineFactory.release(this.pipeline),this.shaderFactory.release(this.pipeline.vs),this.pipeline.fs&&this.pipeline.fs!==this.pipeline.vs&&this.shaderFactory.release(this.pipeline.fs),this._uniformStore.destroy(),this._gpuGeometry?.destroy(),this._destroyed=!0)}needsRedraw(){this._getBindingsUpdateTimestamp()>this._lastDrawTimestamp&&this.setNeedsRedraw("contents of bound textures or buffers updated");let e=this._needsRedraw;return this._needsRedraw=!1,e}setNeedsRedraw(e){this._needsRedraw||(this._needsRedraw=e)}getBindingDebugTable(){return this._bindingTable}predraw(){this.updateShaderInputs(),this.pipeline=this._updatePipeline()}draw(e){let t=this._areBindingsLoading();if(t)return L.info(Pe,`>>> DRAWING ABORTED ${this.id}: ${t} not loaded`)(),!1;try{e.pushDebugGroup(`${this}.predraw(${e})`),this.predraw()}finally{e.popDebugGroup()}let i,o=this.pipeline.isErrored;try{if(e.pushDebugGroup(`${this}.draw(${e})`),this._logDrawCallStart(),this.pipeline=this._updatePipeline(),o=this.pipeline.isErrored,o)L.info(Pe,`>>> DRAWING ABORTED ${this.id}: ${ua}`)(),i=!1;else{let n=this._getBindings(),s=this._getBindGroups(),{indexBuffer:a}=this.vertexArray,l=a?a.byteLength/(a.indexType==="uint32"?4:2):void 0;i=this.pipeline.draw({renderPass:e,vertexArray:this.vertexArray,isInstanced:this.isInstanced,vertexCount:this.vertexCount,instanceCount:this.instanceCount,indexCount:l,transformFeedback:this.transformFeedback||void 0,bindings:n,bindGroups:s,_bindGroupCacheKeys:this._getBindGroupCacheKeys(),uniforms:this.props.uniforms,parameters:this.parameters,topology:this.topology})}}finally{e.popDebugGroup(),this._logDrawCallEnd()}return this._logFramebuffer(e),i?(this._lastDrawTimestamp=this.device.timestamp,this._needsRedraw=!1):o?this._needsRedraw=ua:this._needsRedraw="waiting for resource initialization",i}setGeometry(e){this._gpuGeometry?.destroy();let t=e&&Ks(this.device,e);if(t){this.setTopology(t.topology||"triangle-list");let i=new ft(this.bufferLayout);this.bufferLayout=i.mergeBufferLayouts(t.bufferLayout,this.bufferLayout),this.vertexArray&&this._setGeometryAttributes(t)}this._gpuGeometry=t}setTopology(e){e!==this.topology&&(this.topology=e,this._setPipelineNeedsUpdate("topology"))}setBufferLayout(e){let t=new ft(this.bufferLayout);this.bufferLayout=this._gpuGeometry?t.mergeBufferLayouts(e,this._gpuGeometry.bufferLayout):e,this._setPipelineNeedsUpdate("bufferLayout"),this.pipeline=this._updatePipeline(),this.vertexArray=this.device.createVertexArray({shaderLayout:this.pipeline.shaderLayout,bufferLayout:this.pipeline.bufferLayout}),this._gpuGeometry&&this._setGeometryAttributes(this._gpuGeometry)}setParameters(e){gr(e,this.parameters,2)||(this.parameters=e,this._setPipelineNeedsUpdate("parameters"))}setInstanceCount(e){this.instanceCount=e,this.isInstanced===void 0&&e>0&&(this.isInstanced=!0),this.setNeedsRedraw("instanceCount")}setVertexCount(e){this.vertexCount=e,this.setNeedsRedraw("vertexCount")}setShaderInputs(e){this.shaderInputs=e,this._uniformStore=new zi(this.device,this.shaderInputs.modules);for(let[t,i]of Object.entries(this.shaderInputs.modules))if(_r(i)&&!this.material?.ownsModule(t)){let o=this._uniformStore.getManagedUniformBuffer(t);this.bindings[`${t}Uniforms`]=o}this.setNeedsRedraw("shaderInputs")}setMaterial(e){this.material=e,this.setNeedsRedraw("material")}updateShaderInputs(){this._uniformStore.setUniforms(this.shaderInputs.getUniformValues()),this.setBindings(this._getNonMaterialBindings(this.shaderInputs.getBindingValues())),this.setNeedsRedraw("shaderInputs")}setBindings(e){Object.assign(this.bindings,e),this.setNeedsRedraw("bindings")}setTransformFeedback(e){this.transformFeedback=e,this.setNeedsRedraw("transformFeedback")}setIndexBuffer(e){this.vertexArray.setIndexBuffer(e),this.setNeedsRedraw("indexBuffer")}setAttributes(e,t){let i=t?.disableWarnings??this.props.disableWarnings;e.indices&&L.warn(`Model:${this.id} setAttributes() - indexBuffer should be set using setIndexBuffer()`)(),this.bufferLayout=ia(this.pipeline.shaderLayout,this.bufferLayout);let o=new ft(this.bufferLayout);for(let[n,s]of Object.entries(e)){let a=o.getBufferLayout(n);if(!a){i||L.warn(`Model(${this.id}): Missing layout for buffer "${n}".`)();continue}let l=o.getAttributeNamesForBuffer(a),c=!1;for(let f of l){let u=this._attributeInfos[f];if(u){let h=this.device.type==="webgpu"?o.getBufferIndex(u.bufferName):u.location;this.vertexArray.setBuffer(h,s),c=!0}}!c&&!i&&L.warn(`Model(${this.id}): Ignoring buffer "${s.id}" for unknown attribute "${n}"`)()}this.setNeedsRedraw("attributes")}setConstantAttributes(e,t){for(let[i,o]of Object.entries(e)){let n=this._attributeInfos[i];n?this.vertexArray.setConstantWebGL(n.location,o):(t?.disableWarnings??this.props.disableWarnings)||L.warn(`Model "${this.id}: Ignoring constant supplied for unknown attribute "${i}"`)()}this.setNeedsRedraw("constants")}_areBindingsLoading(){for(let e of Object.values(this.bindings))if(e instanceof ie&&!e.isReady)return e.id;for(let e of Object.values(this.material?.bindings||{}))if(e instanceof ie&&!e.isReady)return e.id;return!1}_getBindings(){let e={};for(let[t,i]of Object.entries(this.bindings))i instanceof ie?i.isReady&&(e[t]=i.texture):e[t]=i;return e}_getBindGroups(){let e=this.pipeline?.shaderLayout||this.props.shaderLayout||{bindings:[]},t=e.bindings.length?Dn(e,this._getBindings()):{0:this._getBindings()};if(!this.material)return t;for(let[i,o]of Object.entries(this.material.getBindingsByGroup())){let n=Number(i);t[n]={...t[n]||{},...o}}return t}_getBindGroupCacheKeys(){let e=this.material?.getBindGroupCacheKey(3);return e?{3:e}:{}}_getBindingsUpdateTimestamp(){let e=0;for(let t of Object.values(this.bindings))t instanceof Fi?e=Math.max(e,t.texture.updateTimestamp):t instanceof U||t instanceof k?e=Math.max(e,t.updateTimestamp):t instanceof ie?e=t.texture?Math.max(e,t.texture.updateTimestamp):1/0:t instanceof et||(e=Math.max(e,t.buffer.updateTimestamp));return Math.max(e,this.material?.getBindingsUpdateTimestamp()||0)}_setGeometryAttributes(e){let t={...e.attributes};for(let[i]of Object.entries(t))!this.pipeline.shaderLayout.attributes.find(o=>o.name===i)&&i!=="positions"&&delete t[i];this.vertexCount=e.vertexCount,this.setIndexBuffer(e.indices||null),this.setAttributes(e.attributes,{disableWarnings:!0}),this.setAttributes(t,{disableWarnings:this.props.disableWarnings}),this.setNeedsRedraw("geometry attributes")}_setPipelineNeedsUpdate(e){this._pipelineNeedsUpdate||(this._pipelineNeedsUpdate=e),this.setNeedsRedraw(e)}_updatePipeline(){if(this._pipelineNeedsUpdate){let e=null,t=null;this.pipeline&&(L.log(1,`Model ${this.id}: Recreating pipeline because "${this._pipelineNeedsUpdate}".`)(),e=this.pipeline.vs,t=this.pipeline.fs),this._pipelineNeedsUpdate=!1;let i=this.shaderFactory.createShader({id:`${this.id}-vertex`,stage:"vertex",source:this.source||this.vs,debugShaders:this.props.debugShaders}),o=null;this.source?o=i:this.fs&&(o=this.shaderFactory.createShader({id:`${this.id}-fragment`,stage:"fragment",source:this.source||this.fs,debugShaders:this.props.debugShaders})),this.pipeline=this.pipelineFactory.createRenderPipeline({...this.props,bindings:void 0,bufferLayout:this.bufferLayout,topology:this.topology,parameters:this.parameters,bindGroups:this._getBindGroups(),vs:i,fs:o}),this._attributeInfos=kn(this.pipeline.shaderLayout,this.bufferLayout),e&&this.shaderFactory.release(e),t&&t!==e&&this.shaderFactory.release(t)}return this.pipeline}_logDrawCallStart(){let e=L.level>3?0:Wf;L.level<2||Date.now()-this._lastLogTime<e||(this._lastLogTime=Date.now(),this._logOpen=!0,L.group(Pe,`>>> DRAWING MODEL ${this.id}`,{collapsed:L.level<=2})())}_logDrawCallEnd(){if(this._logOpen){let e=Js(this.pipeline.shaderLayout,this.id);L.table(Pe,e)();let t=this.shaderInputs.getDebugTable();L.table(Pe,t)();let i=this._getAttributeDebugTable();L.table(Pe,this._attributeInfos)(),L.table(Pe,i)(),L.groupEnd(Pe)(),this._logOpen=!1}}_logFramebuffer(e){let t=this.device.props.debugFramebuffers;if(this._drawCount++,!t)return;let i=e.props.framebuffer;ea(e,i,{id:i?.id||`${this.id}-framebuffer`,minimap:!0})}_getAttributeDebugTable(){let e={};for(let[t,i]of Object.entries(this._attributeInfos)){let o=this.vertexArray.attributes[i.location];e[i.location]={name:t,type:i.shaderType,values:o?this._getBufferOrConstantValues(o,i.bufferDataType):"null"}}if(this.vertexArray.indexBuffer){let{indexBuffer:t}=this.vertexArray,i=t.indexType==="uint32"?new Uint32Array(t.debugData):new Uint16Array(t.debugData);e.indices={name:"indices",type:t.indexType,values:i.toString()}}return e}_getBufferOrConstantValues(e,t){let i=Ct.getTypedArrayConstructor(t);return(e instanceof U?new i(e.debugData):e).toString()}_getNonMaterialBindings(e){if(!this.material)return e;let t={};for(let[i,o]of Object.entries(e))this.material.ownsBinding(i)||(t[i]=o);return t}};m(vr,"defaultProps",{...On.defaultProps,source:void 0,vs:null,fs:null,id:"unnamed",handle:void 0,userData:{},defines:{},modules:[],geometry:null,indexBuffer:null,attributes:{},constantAttributes:{},bindings:{},uniforms:{},varyings:[],isInstanced:void 0,instanceCount:0,vertexCount:0,shaderInputs:void 0,material:void 0,pipelineFactory:void 0,shaderFactory:void 0,transformFeedback:void 0,shaderAssembler:ze.getDefaultShaderAssembler(),debugShaders:void 0,disableWarnings:void 0});var ut=vr;function $f(r){return{type:r.type,shaderLanguage:r.info.shadingLanguage,shaderLanguageVersion:r.info.shadingLanguageVersion,gpu:r.info.gpu,features:r.features}}var Xt=3,qt=class{constructor(e,t={}){m(this,"device");m(this,"modules");m(this,"_materialBindingNames");m(this,"_materialModuleNames");this.device=e,this.modules=t.modules||[];let i=new Me(Object.fromEntries(this.modules.map(o=>[o.name,o])));this._materialBindingNames=Yf(i),this._materialModuleNames=qf(i)}createMaterial(e={}){return new yr(this.device,{...e,factory:this})}getBindingNames(){return Array.from(this._materialBindingNames)}ownsBinding(e){if(this._materialBindingNames.has(e))return!0;let t=$o(e);return t?this._materialModuleNames.has(t):!1}ownsModule(e){return this._materialModuleNames.has(e)}getBindingsByGroup(e){return Object.keys(e).length>0?{[Xt]:e}:{}}};function $o(r){return r.endsWith("Uniforms")?r.slice(0,-8):null}function Yf(r){let e=new Set;for(let t of Object.values(r.modules))for(let i of t.bindingLayout||[])i.group===Xt&&e.add(i.name);return e}function qf(r){let e=new Set;for(let t of Object.values(r.modules))t.name&&t.bindingLayout?.some(i=>i.group===Xt&&i.name===t.name)&&e.add(t.name);return e}var yr=class{constructor(e,t={}){m(this,"id");m(this,"device");m(this,"factory");m(this,"shaderInputs");m(this,"bindings",{});m(this,"_uniformStore");m(this,"_bindGroupCacheToken",{});this.id=t.id||X("material"),this.device=e,this.factory=t.factory||new qt(e,{modules:t.modules||t.shaderInputs?.getModules()||[]});let i=Object.fromEntries((t.shaderInputs?.getModules()||this.factory.modules).map(o=>[o.name,o]));this.shaderInputs=t.shaderInputs||new Me(i),this._uniformStore=new zi(this.device,this.shaderInputs.modules);for(let[o,n]of Object.entries(this.shaderInputs.modules))if(this.ownsModule(o)&&_r(n)){let s=this._uniformStore.getManagedUniformBuffer(o);this.bindings[`${o}Uniforms`]=s}this.updateShaderInputs(),t.bindings&&this._replaceOwnedBindings(t.bindings)}destroy(){this._uniformStore.destroy()}clone(e={}){let t=this.factory.createMaterial({id:e.id,shaderInputs:e.shaderInputs,bindings:{...this.getResourceBindings(),...e.bindings}});return e.shaderInputs||t.setProps(this.shaderInputs.getUniformValues()),e.moduleProps&&t.setProps(e.moduleProps),t}ownsBinding(e){return this.factory.ownsBinding(e)}ownsModule(e){return this.factory.ownsModule(e)}setProps(e){this.shaderInputs.setProps(e),this.updateShaderInputs()}updateShaderInputs(){this._uniformStore.setUniforms(this.shaderInputs.getUniformValues()),this._setOwnedBindings(this.shaderInputs.getBindingValues())&&(this._bindGroupCacheToken={})}getResourceBindings(){let e={};for(let[t,i]of Object.entries(this.bindings))$o(t)||(e[t]=i);return e}getBindings(){let e={},t=e;for(let[i,o]of Object.entries(this.bindings))o instanceof ie?o.isReady&&(t[i]=o.texture):t[i]=o;return e}getBindingsByGroup(){return this.factory.getBindingsByGroup(this.getBindings())}getBindGroupCacheKey(e){return e===Xt?this._bindGroupCacheToken:null}getBindingsUpdateTimestamp(){let e=0;for(let t of Object.values(this.bindings))t instanceof Fi?e=Math.max(e,t.texture.updateTimestamp):t instanceof U||t instanceof k?e=Math.max(e,t.updateTimestamp):t instanceof ie?e=t.texture?Math.max(e,t.texture.updateTimestamp):1/0:t instanceof et||(e=Math.max(e,t.buffer.updateTimestamp));return e}_replaceOwnedBindings(e){this._setOwnedBindings(e)&&(this._bindGroupCacheToken={})}_setOwnedBindings(e){let t=!1;for(let[i,o]of Object.entries(e))o!==void 0&&this.ownsBinding(i)&&this.bindings[i]!==o&&(this.bindings[i]=o,t=!0);return t}};var Zt=class Zt{constructor(e,t=Zt.defaultProps){m(this,"device");m(this,"model");m(this,"transformFeedback");if(!Zt.isSupported(e))throw new Error("BufferTransform not yet implemented on WebGPU");this.device=e,this.model=new ut(this.device,{id:t.id||"buffer-transform-model",fs:t.fs||Po(),topology:t.topology||"point-list",varyings:t.outputs||t.varyings,...t}),this.transformFeedback=this.device.createTransformFeedback({layout:this.model.pipeline.shaderLayout,buffers:t.feedbackBuffers}),this.model.setTransformFeedback(this.transformFeedback),Object.seal(this)}static isSupported(e){return e?.info?.type==="webgl"}destroy(){this.model&&this.model.destroy()}delete(){this.destroy()}run(e){e?.inputBuffers&&this.model.setAttributes(e.inputBuffers),e?.outputBuffers&&this.transformFeedback.setBuffers(e.outputBuffers);let t=this.device.beginRenderPass(e);this.model.draw(t),t.end()}getBuffer(e){return this.transformFeedback.getBuffer(e)}readAsync(e){let t=this.getBuffer(e);if(!t)throw new Error("BufferTransform#getBuffer");if(t instanceof U)return t.readAsync();let{buffer:i,byteOffset:o=0,byteLength:n=i.byteLength}=t;return i.readAsync(o,n)}};m(Zt,"defaultProps",{...ut.defaultProps,outputs:void 0,feedbackBuffers:void 0});var Te=Zt;function Yo(r,e){if(!r)throw new Error(e)}var Ae=class{constructor(e={}){m(this,"id");m(this,"matrix",new O);m(this,"display",!0);m(this,"position",new z);m(this,"rotation",new z);m(this,"scale",new z(1,1,1));m(this,"userData",{});m(this,"props",{});let{id:t}=e;this.id=t||X(this.constructor.name),this._setScenegraphNodeProps(e)}getBounds(){return null}destroy(){}delete(){this.destroy()}setProps(e){return this._setScenegraphNodeProps(e),this}toString(){return`{type: ScenegraphNode, id: ${this.id})}`}setPosition(e){return Yo(e.length===3,"setPosition requires vector argument"),this.position=e,this}setRotation(e){return Yo(e.length===3||e.length===4,"setRotation requires vector argument"),this.rotation=e,this}setScale(e){return Yo(e.length===3,"setScale requires vector argument"),this.scale=e,this}setMatrix(e,t=!0){t?this.matrix.copy(e):this.matrix=e}setMatrixComponents(e){let{position:t,rotation:i,scale:o,update:n=!0}=e;return t&&this.setPosition(t),i&&this.setRotation(i),o&&this.setScale(o),n&&this.updateMatrix(),this}updateMatrix(){if(this.matrix.identity(),this.matrix.translate(this.position),this.rotation.length===4){let e=new O().fromQuaternion(this.rotation);this.matrix.multiplyRight(e)}else this.matrix.rotateXYZ(this.rotation);return this.matrix.scale(this.scale),this}update({position:e,rotation:t,scale:i}={}){return e&&this.setPosition(e),t&&this.setRotation(t),i&&this.setScale(i),this.updateMatrix(),this}getCoordinateUniforms(e,t){t=t||this.matrix;let i=new O(e).multiplyRight(t),o=i.invert(),n=o.transpose();return{viewMatrix:e,modelMatrix:t,objectMatrix:t,worldMatrix:i,worldInverseMatrix:o,worldInverseTransposeMatrix:n}}_setScenegraphNodeProps(e){e?.position&&this.setPosition(e.position),e?.rotation&&this.setRotation(e.rotation),e?.scale&&this.setScale(e.scale),this.updateMatrix(),e?.matrix&&this.setMatrix(e.matrix),Object.assign(this.props,e)}};var qo=class r extends Ae{constructor(t={}){t=Array.isArray(t)?{children:t}:t;let{children:i=[]}=t;L.assert(i.every(o=>o instanceof Ae),"every child must an instance of ScenegraphNode");super(t);m(this,"children");this.children=i}getBounds(){let t=[[1/0,1/0,1/0],[-1/0,-1/0,-1/0]];return this.traverse((i,{worldMatrix:o})=>{let n=i.getBounds();if(!n)return;let[s,a]=n,l=new z(s).add(a).divide([2,2,2]);o.transformAsPoint(l,l);let c=new z(a).subtract(s).divide([2,2,2]);o.transformAsVector(c,c);for(let f=0;f<8;f++){let u=new z(f&1?-1:1,f&2?-1:1,f&4?-1:1).multiply(c).add(l);for(let h=0;h<3;h++)t[0][h]=Math.min(t[0][h],u[h]),t[1][h]=Math.max(t[1][h],u[h])}}),Number.isFinite(t[0][0])?t:null}destroy(){this.children.forEach(t=>t.destroy()),this.removeAll(),super.destroy()}add(...t){for(let i of t)Array.isArray(i)?this.add(...i):this.children.push(i);return this}remove(t){let i=this.children,o=i.indexOf(t);return o>-1&&i.splice(o,1),this}removeAll(){return this.children=[],this}traverse(t,{worldMatrix:i=new O}={}){let o=new O(i).multiplyRight(this.matrix);for(let n of this.children)n instanceof r?n.traverse(t,{worldMatrix:o}):t(n,{worldMatrix:o})}preorderTraversal(t,{worldMatrix:i=new O}={}){let o=new O(i).multiplyRight(this.matrix);t(this,{worldMatrix:o});for(let n of this.children)n instanceof r?n.preorderTraversal(t,{worldMatrix:o}):t(n,{worldMatrix:o})}};var Xo=class extends Ae{constructor(t){super(t);m(this,"model");m(this,"bounds",null);m(this,"managedResources");this.model=t.model,this.managedResources=t.managedResources||[],this.bounds=t.bounds||null,this.setProps(t)}destroy(){this.model&&(this.model.destroy(),this.model=null),this.managedResources.forEach(t=>t.destroy()),this.managedResources=[]}getBounds(){return this.bounds}draw(t){return this.model.draw(t)}};function He(r,e=()=>!0){return Array.isArray(r)?ha(r,e,[]):e(r)?[r]:[]}function ha(r,e,t){let i=-1;for(;++i<r.length;){let o=r[i];Array.isArray(o)?ha(o,e,t):e(o)&&t.push(o)}return t}function Zo({target:r,source:e,start:t=0,count:i=1}){let o=e.length,n=i*o,s=0;for(let a=t;s<o;s++)r[a++]=e[s];for(;s<n;)s<n-s?(r.copyWithin(t+s,t,t+s),s*=2):(r.copyWithin(t+s,t,t+n-s),s=n);return r}function B(r,e,t){if(r===e)return!0;if(!t||!r||!e)return!1;if(Array.isArray(r)){if(!Array.isArray(e)||r.length!==e.length)return!1;for(let i=0;i<r.length;i++)if(!B(r[i],e[i],t-1))return!1;return!0}if(Array.isArray(e))return!1;if(typeof r=="object"&&typeof e=="object"){let i=Object.keys(r),o=Object.keys(e);if(i.length!==o.length)return!1;for(let n of i)if(!e.hasOwnProperty(n)||!B(r[n],e[n],t-1))return!1;return!0}return!1}function N(r,e){if(!r)throw new Error(e||"deck.gl: assertion failed.")}var Xf=`struct LayerUniforms {
  opacity: f32,
};

@group(0) @binding(auto)
var<uniform> layer: LayerUniforms;
`,pa=`layout(std140) uniform layerUniforms {
  uniform float opacity;
} layer;
`,Ko={name:"layer",source:Xf,vs:pa,fs:pa,getUniforms:r=>({opacity:Math.pow(r.opacity,.45454545454545453)}),uniformTypes:{opacity:"f32"}};var Zf=`

@must_use
fn deckgl_premultiplied_alpha(fragColor: vec4<f32>) -> vec4<f32> {
    return vec4(fragColor.rgb * fragColor.a, fragColor.a);
};
`,da={name:"color",dependencies:[],source:Zf,getUniforms:r=>({})};var Kf=`const SMOOTH_EDGE_RADIUS: f32 = 0.5;

struct VertexGeometry {
  position: vec4<f32>,
  worldPosition: vec3<f32>,
  worldPositionAlt: vec3<f32>,
  normal: vec3<f32>,
  uv: vec2<f32>,
  pickingColor: vec3<f32>,
};

var<private> geometry_: VertexGeometry = VertexGeometry(
  vec4<f32>(0.0, 0.0, 1.0, 0.0),
  vec3<f32>(0.0, 0.0, 0.0),
  vec3<f32>(0.0, 0.0, 0.0),
  vec3<f32>(0.0, 0.0, 0.0),
  vec2<f32>(0.0, 0.0),
  vec3<f32>(0.0, 0.0, 0.0)
);

struct FragmentGeometry {
  uv: vec2<f32>,
};

var<private> fragmentGeometry: FragmentGeometry;

fn smoothedge(edge: f32, x: f32) -> f32 {
  return smoothstep(edge - SMOOTH_EDGE_RADIUS, edge + SMOOTH_EDGE_RADIUS, x);
}
`,ma="#define SMOOTH_EDGE_RADIUS 0.5",Jf=`${ma}

struct VertexGeometry {
  vec4 position;
  vec3 worldPosition;
  vec3 worldPositionAlt;
  vec3 normal;
  vec2 uv;
  vec3 pickingColor;
} geometry = VertexGeometry(
  vec4(0.0, 0.0, 1.0, 0.0),
  vec3(0.0),
  vec3(0.0),
  vec3(0.0),
  vec2(0.0),
  vec3(0.0)
);
`,Qf=`${ma}

struct FragmentGeometry {
  vec2 uv;
} geometry;

float smoothedge(float edge, float x) {
  return smoothstep(edge - SMOOTH_EDGE_RADIUS, edge + SMOOTH_EDGE_RADIUS, x);
}
`,Sr={name:"geometry",source:Kf,vs:Jf,fs:Qf};function eu(r,e){if(r===e)return!0;if(Array.isArray(r)){let t=r.length;if(!e||e.length!==t)return!1;for(let i=0;i<t;i++)if(r[i]!==e[i])return!1;return!0}return!1}function fe(r){let e={},t;return i=>{for(let o in i)if(!eu(i[o],e[o])){t=r(i),e=i;break}return t}}var ga=[0,0,0,0],tu=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,0],_a=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],iu=[0,0,0],ba=[0,0,0],ru={default:-1,cartesian:0,lnglat:1,"meter-offsets":2,"lnglat-offsets":3};function We(r){let e=ru[r];if(e===void 0)throw new Error(`Invalid coordinateSystem: ${r}`);return e}var ou=fe(su);function Jo(r,e,t=ba){t.length<3&&(t=[t[0],t[1],0]);let i=t,o,n=!0;switch(e==="lnglat-offsets"||e==="meter-offsets"?o=t:o=r.isGeospatial?[Math.fround(r.longitude),Math.fround(r.latitude),0]:null,r.projectionMode){case j.WEB_MERCATOR:(e==="lnglat"||e==="cartesian")&&(o=[0,0,0],n=!1);break;case j.WEB_MERCATOR_AUTO_OFFSET:e==="lnglat"?i=o:e==="cartesian"&&(i=[Math.fround(r.center[0]),Math.fround(r.center[1]),0],o=r.unprojectPosition(i),i[0]-=t[0],i[1]-=t[1],i[2]-=t[2]);break;case j.IDENTITY:i=r.position.map(Math.fround),i[2]=i[2]||0;break;case j.GLOBE:n=!1,o=null;break;default:n=!1}return{geospatialOrigin:o,shaderCoordinateOrigin:i,offsetMode:n}}function nu(r,e,t){let{viewMatrixUncentered:i,projectionMatrix:o}=r,{viewMatrix:n,viewProjectionMatrix:s}=r,a=ga,l=ga,c=r.cameraPosition,{geospatialOrigin:f,shaderCoordinateOrigin:u,offsetMode:h}=Jo(r,e,t);return h&&(l=r.projectPosition(f||u),c=[c[0]-l[0],c[1]-l[1],c[2]-l[2]],l[3]=1,a=te.transformMat4([],l,s),n=i||n,s=H.multiply([],o,n),s=H.multiply([],s,tu)),{viewMatrix:n,viewProjectionMatrix:s,projectionCenter:a,originCommon:l,cameraPosCommon:c,shaderCoordinateOrigin:u,geospatialOrigin:f}}function va({viewport:r,devicePixelRatio:e=1,modelMatrix:t=null,coordinateSystem:i="default",coordinateOrigin:o=ba,autoWrapLongitude:n=!1}){i==="default"&&(i=r.isGeospatial?"lnglat":"cartesian");let s=ou({viewport:r,devicePixelRatio:e,coordinateSystem:i,coordinateOrigin:o});return s.wrapLongitude=n,s.modelMatrix=t||_a,s}function su({viewport:r,devicePixelRatio:e,coordinateSystem:t,coordinateOrigin:i}){let{projectionCenter:o,viewProjectionMatrix:n,originCommon:s,cameraPosCommon:a,shaderCoordinateOrigin:l,geospatialOrigin:c}=nu(r,t,i),f=r.getDistanceScales(),u=[r.width*e,r.height*e],h=te.transformMat4([],[0,0,-r.focalDistance,1],r.projectionMatrix)[3]||1,p={coordinateSystem:We(t),projectionMode:r.projectionMode,coordinateOrigin:l,commonOrigin:s.slice(0,3),center:o,pseudoMeters:!!r._pseudoMeters,viewportSize:u,devicePixelRatio:e,focalDistance:h,commonUnitsPerMeter:f.unitsPerMeter,commonUnitsPerWorldUnit:f.unitsPerMeter,commonUnitsPerWorldUnit2:iu,scale:r.scale,wrapLongitude:!1,viewProjectionMatrix:n,modelMatrix:_a,cameraPosition:a};if(c){let d=r.getDistanceScales(c);switch(t){case"meter-offsets":p.commonUnitsPerWorldUnit=d.unitsPerMeter,p.commonUnitsPerWorldUnit2=d.unitsPerMeter2;break;case"lnglat":case"lnglat-offsets":r._pseudoMeters||(p.commonUnitsPerMeter=d.unitsPerMeter),p.commonUnitsPerWorldUnit=d.unitsPerDegree,p.commonUnitsPerWorldUnit2=d.unitsPerDegree2;break;case"cartesian":p.commonUnitsPerWorldUnit=[1,1,d.unitsPerMeter[2]],p.commonUnitsPerWorldUnit2=[0,0,d.unitsPerMeter2[2]];break;default:break}}return p}var au=["default","lnglat","meter-offsets","lnglat-offsets","cartesian"],lu=au.map(r=>`const COORDINATE_SYSTEM_${r.toUpperCase().replaceAll("-","_")}: i32 = ${We(r)};`).join(""),cu=Object.keys(j).map(r=>`const PROJECTION_MODE_${r}: i32 = ${j[r]};`).join(""),fu=Object.keys(De).map(r=>`const UNIT_${r.toUpperCase()}: i32 = ${De[r]};`).join(""),uu=`${lu}
${cu}
${fu}

const TILE_SIZE: f32 = 512.0;
const PI: f32 = 3.1415926536;
const WORLD_SCALE: f32 = TILE_SIZE / (PI * 2.0);
const ZERO_64_LOW: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
const EARTH_RADIUS: f32 = 6370972.0; // meters
const GLOBE_RADIUS: f32 = 256.0;

// -----------------------------------------------------------------------------
// Uniform block (converted from GLSL uniform block)
// -----------------------------------------------------------------------------
struct ProjectUniforms {
  wrapLongitude: i32,
  coordinateSystem: i32,
  commonUnitsPerMeter: vec3<f32>,
  projectionMode: i32,
  scale: f32,
  commonUnitsPerWorldUnit: vec3<f32>,
  commonUnitsPerWorldUnit2: vec3<f32>,
  center: vec4<f32>,
  modelMatrix: mat4x4<f32>,
  viewProjectionMatrix: mat4x4<f32>,
  viewportSize: vec2<f32>,
  devicePixelRatio: f32,
  focalDistance: f32,
  cameraPosition: vec3<f32>,
  coordinateOrigin: vec3<f32>,
  commonOrigin: vec3<f32>,
  pseudoMeters: i32,
};

@group(0) @binding(auto)
var<uniform> project: ProjectUniforms;

// -----------------------------------------------------------------------------
// Geometry data shared across the project helpers.
// The active layer shader is responsible for populating this private module
// state before calling the project functions below.
// -----------------------------------------------------------------------------

// Structure to carry additional geometry data used by deck.gl filters.
struct Geometry {
  worldPosition: vec3<f32>,
  worldPositionAlt: vec3<f32>,
  position: vec4<f32>,
  normal: vec3<f32>,
  uv: vec2<f32>,
  pickingColor: vec3<f32>,
};

var<private> geometry: Geometry;
`,ya=`${uu}

// -----------------------------------------------------------------------------
// Functions
// -----------------------------------------------------------------------------

// Returns an adjustment factor for commonUnitsPerMeter
fn _project_size_at_latitude(lat: f32) -> f32 {
  let y = clamp(lat, -89.9, 89.9);
  return 1.0 / cos(radians(y));
}

// Overloaded version: scales a value in meters at a given latitude.
fn _project_size_at_latitude_m(meters: f32, lat: f32) -> f32 {
  return meters * project.commonUnitsPerMeter.z * _project_size_at_latitude(lat);
}

// Computes a non-linear scale factor based on geometry.
// (Note: This function relies on "geometry" being provided.)
fn project_size() -> f32 {
  if (project.projectionMode == PROJECTION_MODE_WEB_MERCATOR &&
      project.coordinateSystem == COORDINATE_SYSTEM_LNGLAT &&
      project.pseudoMeters == 0) {
    if (geometry.position.w == 0.0) {
      return _project_size_at_latitude(geometry.worldPosition.y);
    }
    let y: f32 = geometry.position.y / TILE_SIZE * 2.0 - 1.0;
    let y2 = y * y;
    let y4 = y2 * y2;
    let y6 = y4 * y2;
    return 1.0 + 4.9348 * y2 + 4.0587 * y4 + 1.5642 * y6;
  }
  return 1.0;
}

// Overloads to scale offsets (meters to world units)
fn project_size_float(meters: f32) -> f32 {
  return meters * project.commonUnitsPerMeter.z * project_size();
}

fn project_size_vec2(meters: vec2<f32>) -> vec2<f32> {
  return meters * project.commonUnitsPerMeter.xy * project_size();
}

fn project_size_vec3(meters: vec3<f32>) -> vec3<f32> {
  return meters * project.commonUnitsPerMeter * project_size();
}

fn project_size_vec4(meters: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(meters.xyz * project.commonUnitsPerMeter, meters.w);
}

// Returns a rotation matrix aligning the z\u2011axis with the given up vector.
fn project_get_orientation_matrix(up: vec3<f32>) -> mat3x3<f32> {
  let uz = normalize(up);
  let ux = select(
    vec3<f32>(1.0, 0.0, 0.0),
    normalize(vec3<f32>(uz.y, -uz.x, 0.0)),
    abs(uz.z) == 1.0
  );
  let uy = cross(uz, ux);
  return mat3x3<f32>(ux, uy, uz);
}

// Since WGSL does not support "out" parameters, we return a struct.
struct RotationResult {
  needsRotation: bool,
  transform: mat3x3<f32>,
};

fn project_needs_rotation(commonPosition: vec3<f32>) -> RotationResult {
  if (project.projectionMode == PROJECTION_MODE_GLOBE) {
    return RotationResult(true, project_get_orientation_matrix(commonPosition));
  } else {
    return RotationResult(false, mat3x3<f32>());  // identity alternative if needed
  };
}

// Projects a normal vector from the current coordinate system to world space.
fn project_normal(vector: vec3<f32>) -> vec3<f32> {
  let normal_modelspace = project.modelMatrix * vec4<f32>(vector, 0.0);
  var n = normalize(normal_modelspace.xyz * project.commonUnitsPerMeter);
  let rotResult = project_needs_rotation(geometry.position.xyz);
  if (rotResult.needsRotation) {
    n = rotResult.transform * n;
  }
  return n;
}

// Applies a scale offset based on y-offset (dy)
fn project_offset_(offset: vec4<f32>) -> vec4<f32> {
  let dy: f32 = offset.y;
  let commonUnitsPerWorldUnit = project.commonUnitsPerWorldUnit + project.commonUnitsPerWorldUnit2 * dy;
  return vec4<f32>(offset.xyz * commonUnitsPerWorldUnit, offset.w);
}

// Projects lng/lat coordinates to a unit tile [0,1]
fn project_mercator_(lnglat: vec2<f32>) -> vec2<f32> {
  var x = lnglat.x;
  if (project.wrapLongitude != 0) {
    x = ((x + 180.0) % 360.0) - 180.0;
  }
  let y = clamp(lnglat.y, -89.9, 89.9);
  return vec2<f32>(
    radians(x) + PI,
    PI + log(tan(PI * 0.25 + radians(y) * 0.5))
  ) * WORLD_SCALE;
}

// Projects lng/lat/z coordinates for a globe projection.
fn project_globe_(lnglatz: vec3<f32>) -> vec3<f32> {
  let lambda = radians(lnglatz.x);
  let phi = radians(lnglatz.y);
  let cosPhi = cos(phi);
  let D = (lnglatz.z / EARTH_RADIUS + 1.0) * GLOBE_RADIUS;
  return vec3<f32>(
    sin(lambda) * cosPhi,
    -cos(lambda) * cosPhi,
    sin(phi)
  ) * D;
}

// Projects positions (with an optional 64-bit low part) from the input
// coordinate system to the common space.
fn project_position_vec4_f64(position: vec4<f32>, position64Low: vec3<f32>) -> vec4<f32> {
  var position_world = project.modelMatrix * position;

  // Work around for a Mac+NVIDIA bug:
  if (project.projectionMode == PROJECTION_MODE_WEB_MERCATOR) {
    if (project.coordinateSystem == COORDINATE_SYSTEM_LNGLAT) {
      return vec4<f32>(
        project_mercator_(position_world.xy),
        _project_size_at_latitude_m(position_world.z, position_world.y),
        position_world.w
      );
    }
    if (project.coordinateSystem == COORDINATE_SYSTEM_CARTESIAN) {
      position_world = vec4f(position_world.xyz + project.coordinateOrigin, position_world.w);
    }
  }
  if (project.projectionMode == PROJECTION_MODE_GLOBE) {
    if (project.coordinateSystem == COORDINATE_SYSTEM_LNGLAT) {
      return vec4<f32>(
        project_globe_(position_world.xyz),
        position_world.w
      );
    }
  }
  if (project.projectionMode == PROJECTION_MODE_WEB_MERCATOR_AUTO_OFFSET) {
    if (project.coordinateSystem == COORDINATE_SYSTEM_LNGLAT) {
      if (abs(position_world.y - project.coordinateOrigin.y) > 0.25) {
        return vec4<f32>(
          project_mercator_(position_world.xy) - project.commonOrigin.xy,
          project_size_float(position_world.z),
          position_world.w
        );
      }
    }
  }
  if (project.projectionMode == PROJECTION_MODE_IDENTITY ||
      (project.projectionMode == PROJECTION_MODE_WEB_MERCATOR_AUTO_OFFSET &&
       (project.coordinateSystem == COORDINATE_SYSTEM_LNGLAT ||
        project.coordinateSystem == COORDINATE_SYSTEM_CARTESIAN))) {
    position_world = vec4f(position_world.xyz - project.coordinateOrigin, position_world.w);
  }

  return project_offset_(position_world) +
         project_offset_(project.modelMatrix * vec4<f32>(position64Low, 0.0));
}

// Overloaded versions for different input types.
fn project_position_vec4_f32(position: vec4<f32>) -> vec4<f32> {
  return project_position_vec4_f64(position, ZERO_64_LOW);
}

fn project_position_vec3_f64(position: vec3<f32>, position64Low: vec3<f32>) -> vec3<f32> {
  let projected_position = project_position_vec4_f64(vec4<f32>(position, 1.0), position64Low);
  return projected_position.xyz;
}

fn project_position_vec3_f32(position: vec3<f32>) -> vec3<f32> {
  let projected_position = project_position_vec4_f64(vec4<f32>(position, 1.0), ZERO_64_LOW);
  return projected_position.xyz;
}

fn project_position_vec2_f32(position: vec2<f32>) -> vec2<f32> {
  let projected_position = project_position_vec4_f64(vec4<f32>(position, 0.0, 1.0), ZERO_64_LOW);
  return projected_position.xy;
}

// Transforms a common space position to clip space.
fn project_common_position_to_clipspace_with_projection(position: vec4<f32>, viewProjectionMatrix: mat4x4<f32>, center: vec4<f32>) -> vec4<f32> {
  return viewProjectionMatrix * position + center;
}

// Uses the project viewProjectionMatrix and center.
fn project_common_position_to_clipspace(position: vec4<f32>) -> vec4<f32> {
  return project_common_position_to_clipspace_with_projection(position, project.viewProjectionMatrix, project.center);
}

// Returns a clip space offset corresponding to a given number of screen pixels.
fn project_pixel_size_to_clipspace(pixels: vec2<f32>) -> vec2<f32> {
  let offset = pixels / project.viewportSize * project.devicePixelRatio * 2.0;
  return offset * project.focalDistance;
}

fn project_meter_size_to_pixel(meters: f32) -> f32 {
  return project_size_float(meters) * project.scale;
}

fn project_unit_size_to_pixel(size: f32, unit: i32) -> f32 {
  if (unit == UNIT_METERS) {
    return project_meter_size_to_pixel(size);
  } else if (unit == UNIT_COMMON) {
    return size * project.scale;
  }
  // UNIT_PIXELS: no scaling applied.
  return size;
}

fn project_pixel_size_float(pixels: f32) -> f32 {
  return pixels / project.scale;
}

fn project_pixel_size_vec2(pixels: vec2<f32>) -> vec2<f32> {
  return pixels / project.scale;
}
`;var hu=["default","lnglat","meter-offsets","lnglat-offsets","cartesian"],pu=hu.map(r=>`const int COORDINATE_SYSTEM_${r.toUpperCase().replaceAll("-","_")} = ${We(r)};`).join(""),du=Object.keys(j).map(r=>`const int PROJECTION_MODE_${r} = ${j[r]};`).join(""),mu=Object.keys(De).map(r=>`const int UNIT_${r.toUpperCase()} = ${De[r]};`).join(""),Sa=`${pu}
${du}
${mu}
layout(std140) uniform projectUniforms {
bool wrapLongitude;
int coordinateSystem;
vec3 commonUnitsPerMeter;
int projectionMode;
float scale;
vec3 commonUnitsPerWorldUnit;
vec3 commonUnitsPerWorldUnit2;
vec4 center;
mat4 modelMatrix;
mat4 viewProjectionMatrix;
vec2 viewportSize;
float devicePixelRatio;
float focalDistance;
vec3 cameraPosition;
vec3 coordinateOrigin;
vec3 commonOrigin;
bool pseudoMeters;
} project;
const float TILE_SIZE = 512.0;
const float PI = 3.1415926536;
const float WORLD_SCALE = TILE_SIZE / (PI * 2.0);
const vec3 ZERO_64_LOW = vec3(0.0);
const float EARTH_RADIUS = 6370972.0;
const float GLOBE_RADIUS = 256.0;
float project_size_at_latitude(float lat) {
float y = clamp(lat, -89.9, 89.9);
return 1.0 / cos(radians(y));
}
float project_size() {
if (project.projectionMode == PROJECTION_MODE_WEB_MERCATOR &&
project.coordinateSystem == COORDINATE_SYSTEM_LNGLAT &&
project.pseudoMeters == false) {
if (geometry.position.w == 0.0) {
return project_size_at_latitude(geometry.worldPosition.y);
}
float y = geometry.position.y / TILE_SIZE * 2.0 - 1.0;
float y2 = y * y;
float y4 = y2 * y2;
float y6 = y4 * y2;
return 1.0 + 4.9348 * y2 + 4.0587 * y4 + 1.5642 * y6;
}
return 1.0;
}
float project_size_at_latitude(float meters, float lat) {
return meters * project.commonUnitsPerMeter.z * project_size_at_latitude(lat);
}
float project_size(float meters) {
return meters * project.commonUnitsPerMeter.z * project_size();
}
vec2 project_size(vec2 meters) {
return meters * project.commonUnitsPerMeter.xy * project_size();
}
vec3 project_size(vec3 meters) {
return meters * project.commonUnitsPerMeter * project_size();
}
vec4 project_size(vec4 meters) {
return vec4(meters.xyz * project.commonUnitsPerMeter, meters.w);
}
mat3 project_get_orientation_matrix(vec3 up) {
vec3 uz = normalize(up);
vec3 ux = abs(uz.z) == 1.0 ? vec3(1.0, 0.0, 0.0) : normalize(vec3(uz.y, -uz.x, 0));
vec3 uy = cross(uz, ux);
return mat3(ux, uy, uz);
}
bool project_needs_rotation(vec3 commonPosition, out mat3 transform) {
if (project.projectionMode == PROJECTION_MODE_GLOBE) {
transform = project_get_orientation_matrix(commonPosition);
return true;
}
return false;
}
vec3 project_normal(vec3 vector) {
vec4 normal_modelspace = project.modelMatrix * vec4(vector, 0.0);
vec3 n = normalize(normal_modelspace.xyz * project.commonUnitsPerMeter);
mat3 rotation;
if (project_needs_rotation(geometry.position.xyz, rotation)) {
n = rotation * n;
}
return n;
}
vec4 project_offset_(vec4 offset) {
float dy = offset.y;
vec3 commonUnitsPerWorldUnit = project.commonUnitsPerWorldUnit + project.commonUnitsPerWorldUnit2 * dy;
return vec4(offset.xyz * commonUnitsPerWorldUnit, offset.w);
}
vec2 project_mercator_(vec2 lnglat) {
float x = lnglat.x;
if (project.wrapLongitude) {
x = mod(x + 180., 360.0) - 180.;
}
float y = clamp(lnglat.y, -89.9, 89.9);
return vec2(
radians(x) + PI,
PI + log(tan_fp32(PI * 0.25 + radians(y) * 0.5))
) * WORLD_SCALE;
}
vec3 project_globe_(vec3 lnglatz) {
float lambda = radians(lnglatz.x);
float phi = radians(lnglatz.y);
float cosPhi = cos(phi);
float D = (lnglatz.z / EARTH_RADIUS + 1.0) * GLOBE_RADIUS;
return vec3(
sin(lambda) * cosPhi,
-cos(lambda) * cosPhi,
sin(phi)
) * D;
}
vec4 project_position(vec4 position, vec3 position64Low) {
vec4 position_world = project.modelMatrix * position;
if (project.projectionMode == PROJECTION_MODE_WEB_MERCATOR) {
if (project.coordinateSystem == COORDINATE_SYSTEM_LNGLAT) {
return vec4(
project_mercator_(position_world.xy),
project_size_at_latitude(position_world.z, position_world.y),
position_world.w
);
}
if (project.coordinateSystem == COORDINATE_SYSTEM_CARTESIAN) {
position_world.xyz += project.coordinateOrigin;
}
}
if (project.projectionMode == PROJECTION_MODE_GLOBE) {
if (project.coordinateSystem == COORDINATE_SYSTEM_LNGLAT) {
return vec4(
project_globe_(position_world.xyz),
position_world.w
);
}
}
if (project.projectionMode == PROJECTION_MODE_WEB_MERCATOR_AUTO_OFFSET) {
if (project.coordinateSystem == COORDINATE_SYSTEM_LNGLAT) {
if (abs(position_world.y - project.coordinateOrigin.y) > 0.25) {
return vec4(
project_mercator_(position_world.xy) - project.commonOrigin.xy,
project_size(position_world.z),
position_world.w
);
}
}
}
if (project.projectionMode == PROJECTION_MODE_IDENTITY ||
(project.projectionMode == PROJECTION_MODE_WEB_MERCATOR_AUTO_OFFSET &&
(project.coordinateSystem == COORDINATE_SYSTEM_LNGLAT ||
project.coordinateSystem == COORDINATE_SYSTEM_CARTESIAN))) {
position_world.xyz -= project.coordinateOrigin;
}
return project_offset_(position_world) + project_offset_(project.modelMatrix * vec4(position64Low, 0.0));
}
vec4 project_position(vec4 position) {
return project_position(position, ZERO_64_LOW);
}
vec3 project_position(vec3 position, vec3 position64Low) {
vec4 projected_position = project_position(vec4(position, 1.0), position64Low);
return projected_position.xyz;
}
vec3 project_position(vec3 position) {
vec4 projected_position = project_position(vec4(position, 1.0), ZERO_64_LOW);
return projected_position.xyz;
}
vec2 project_position(vec2 position) {
vec4 projected_position = project_position(vec4(position, 0.0, 1.0), ZERO_64_LOW);
return projected_position.xy;
}
vec4 project_common_position_to_clipspace(vec4 position, mat4 viewProjectionMatrix, vec4 center) {
return viewProjectionMatrix * position + center;
}
vec4 project_common_position_to_clipspace(vec4 position) {
return project_common_position_to_clipspace(position, project.viewProjectionMatrix, project.center);
}
vec2 project_pixel_size_to_clipspace(vec2 pixels) {
vec2 offset = pixels / project.viewportSize * project.devicePixelRatio * 2.0;
return offset * project.focalDistance;
}
float project_size_to_pixel(float meters) {
return project_size(meters) * project.scale;
}
vec2 project_size_to_pixel(vec2 meters) {
return project_size(meters) * project.scale;
}
float project_size_to_pixel(float size, int unit) {
if (unit == UNIT_METERS) return project_size_to_pixel(size);
if (unit == UNIT_COMMON) return size * project.scale;
return size;
}
float project_pixel_size(float pixels) {
return pixels / project.scale;
}
vec2 project_pixel_size(vec2 pixels) {
return pixels / project.scale;
}
`;var gu={};function _u(r=gu){return"viewport"in r?va(r):{}}var ht={name:"project",dependencies:[Co,Sr],source:ya,vs:Sa,getUniforms:_u,uniformTypes:{wrapLongitude:"f32",coordinateSystem:"i32",commonUnitsPerMeter:"vec3<f32>",projectionMode:"i32",scale:"f32",commonUnitsPerWorldUnit:"vec3<f32>",commonUnitsPerWorldUnit2:"vec3<f32>",center:"vec4<f32>",modelMatrix:"mat4x4<f32>",viewProjectionMatrix:"mat4x4<f32>",viewportSize:"vec2<f32>",devicePixelRatio:"f32",focalDistance:"f32",cameraPosition:"vec3<f32>",coordinateOrigin:"vec3<f32>",commonOrigin:"vec3<f32>",pseudoMeters:"f32"}};var bu=`// Define a structure to hold both the clip-space position and the common position.
struct ProjectResult {
  clipPosition: vec4<f32>,
  commonPosition: vec4<f32>,
};

// This function mimics the GLSL version with the 'out' parameter by returning both values.
fn project_position_to_clipspace_and_commonspace(
    position: vec3<f32>,
    position64Low: vec3<f32>,
    offset: vec3<f32>
) -> ProjectResult {
  // Compute the projected position.
  let projectedPosition: vec3<f32> = project_position_vec3_f64(position, position64Low);

  // Start with the provided offset.
  var finalOffset: vec3<f32> = offset;

  // Get whether a rotation is needed and the rotation matrix.
  let rotationResult = project_needs_rotation(projectedPosition);

  // If rotation is needed, update the offset.
  if (rotationResult.needsRotation) {
    finalOffset = rotationResult.transform * offset;
  }

  // Compute the common position.
  let commonPosition: vec4<f32> = vec4<f32>(projectedPosition + finalOffset, 1.0);

  // Convert to clip-space.
  let clipPosition: vec4<f32> = project_common_position_to_clipspace(commonPosition);

  return ProjectResult(clipPosition, commonPosition);
}

// A convenience overload that returns only the clip-space position.
fn project_position_to_clipspace(
    position: vec3<f32>,
    position64Low: vec3<f32>,
    offset: vec3<f32>
) -> vec4<f32> {
  return project_position_to_clipspace_and_commonspace(position, position64Low, offset).clipPosition;
}
`,vu=`vec4 project_position_to_clipspace(
  vec3 position, vec3 position64Low, vec3 offset, out vec4 commonPosition
) {
  vec3 projectedPosition = project_position(position, position64Low);
  mat3 rotation;
  if (project_needs_rotation(projectedPosition, rotation)) {
    // offset is specified as ENU
    // when in globe projection, rotate offset so that the ground alighs with the surface of the globe
    offset = rotation * offset;
  }
  commonPosition = vec4(projectedPosition + offset, 1.0);
  return project_common_position_to_clipspace(commonPosition);
}

vec4 project_position_to_clipspace(
  vec3 position, vec3 position64Low, vec3 offset
) {
  vec4 commonPosition;
  return project_position_to_clipspace(position, position64Low, offset, commonPosition);
}
`,xa={name:"project32",dependencies:[ht],source:bu,vs:vu};function Qo(){return[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}function Ce(r,e){let t=te.transformMat4([],e,r);return te.scale(t,t,1/t[3]),t}function Kt(r,e,t){return r<e?e:r>t?t:r}function yu(r){return Math.log(r)*Math.LOG2E}var Jt=Math.log2||yu;function re(r,e){if(!r)throw new Error(e||"@math.gl/web-mercator: assertion failed.")}var oe=Math.PI,wa=oe/4,Z=oe/180,en=180/oe,pt=512,xr=4003e4,$=85.051129,Ea=1.5;function tn(r){return Jt(r)}function K(r){let[e,t]=r;re(Number.isFinite(e)),re(Number.isFinite(t)&&t>=-90&&t<=90,"invalid latitude");let i=e*Z,o=t*Z,n=pt*(i+oe)/(2*oe),s=pt*(oe+Math.log(Math.tan(wa+o*.5)))/(2*oe);return[n,s]}function Y(r){let[e,t]=r,i=e/pt*(2*oe)-oe,o=2*(Math.atan(Math.exp(t/pt*(2*oe)-oe))-wa);return[i*en,o*en]}function rn(r){let{latitude:e}=r;re(Number.isFinite(e));let t=Math.cos(e*Z);return tn(xr*t)-9}function Qt(r){let e=Math.cos(r*Z);return pt/xr/e}function dt(r){let{latitude:e,longitude:t,highPrecision:i=!1}=r;re(Number.isFinite(e)&&Number.isFinite(t));let o=pt,n=Math.cos(e*Z),s=o/360,a=s/n,l=o/xr/n,c={unitsPerMeter:[l,l,l],metersPerUnit:[1/l,1/l,1/l],unitsPerDegree:[s,a,l],degreesPerUnit:[1/s,1/a,1/l]};if(i){let f=Z*Math.tan(e*Z)/n,u=s*f/2,h=o/xr*f,p=h/a*l;c.unitsPerDegree2=[0,u,h],c.unitsPerMeter2=[p,0,p]}return c}function ei(r,e){let[t,i,o]=r,[n,s,a]=e,{unitsPerMeter:l,unitsPerMeter2:c}=dt({longitude:t,latitude:i,highPrecision:!0}),f=K(r);f[0]+=n*(l[0]+c[0]*s),f[1]+=s*(l[1]+c[1]*s);let u=Y(f),h=(o||0)+(a||0);return Number.isFinite(o)||Number.isFinite(a)?[u[0],u[1],h]:u}function wr(r){let{height:e,pitch:t,bearing:i,altitude:o,scale:n,center:s}=r,a=Qo();H.translate(a,a,[0,0,-o]),H.rotateX(a,a,-t*Z),H.rotateZ(a,a,i*Z);let l=n/e;return H.scale(a,a,[l,l,l]),s&&H.translate(a,a,ee.negate([],s)),a}function on(r){let{width:e,height:t,altitude:i,pitch:o=0,offset:n,center:s,scale:a,nearZMultiplier:l=1,farZMultiplier:c=1}=r,{fovy:f=me(Ea)}=r;i!==void 0&&(f=me(i));let u=f*Z,h=o*Z,p=$e(f),d=p;s&&(d+=s[2]*a/Math.cos(h)/t);let g=u*(.5+(n?n[1]:0)/t),b=Math.sin(g)*d/Math.sin(Kt(Math.PI/2-h-g,.01,Math.PI-.01)),v=Math.sin(h)*b+d,y=d*10,_=Math.min(v*c,y);return{fov:u,aspect:e/t,focalDistance:p,near:l,far:_}}function me(r){return 2*Math.atan(.5/r)*en}function $e(r){return .5/Math.tan(.5*r*Z)}function mt(r,e){let[t,i,o=0]=r;return re(Number.isFinite(t)&&Number.isFinite(i)&&Number.isFinite(o)),Ce(e,[t,i,o,1])}function Le(r,e,t=0){let[i,o,n]=r;if(re(Number.isFinite(i)&&Number.isFinite(o),"invalid pixel coordinate"),Number.isFinite(n))return Ce(e,[i,o,n,1]);let s=Ce(e,[i,o,0,1]),a=Ce(e,[i,o,1,1]),l=s[2],c=a[2],f=l===c?0:((t||0)-l)/(c-l);return pe.lerp([],s,a,f)}function Er(r){let{width:e,height:t,bounds:i,minExtent:o=0,maxZoom:n=24,offset:s=[0,0]}=r,[[a,l],[c,f]]=i,u=Su(r.padding),h=K([a,Kt(f,-$,$)]),p=K([c,Kt(l,-$,$)]),d=[Math.max(Math.abs(p[0]-h[0]),o),Math.max(Math.abs(p[1]-h[1]),o)],g=[e-u.left-u.right-Math.abs(s[0])*2,t-u.top-u.bottom-Math.abs(s[1])*2];re(g[0]>0&&g[1]>0);let b=g[0]/d[0],v=g[1]/d[1],y=(u.right-u.left)/2/b,_=(u.top-u.bottom)/2/v,S=[(p[0]+h[0])/2+y,(p[1]+h[1])/2+_],P=Y(S),x=Math.min(n,Jt(Math.abs(Math.min(b,v))));return re(Number.isFinite(x)),{longitude:P[0],latitude:P[1],zoom:x}}function Su(r=0){return typeof r=="number"?{top:r,bottom:r,left:r,right:r}:(re(Number.isFinite(r.top)&&Number.isFinite(r.bottom)&&Number.isFinite(r.left)&&Number.isFinite(r.right)),r)}var Ma=Math.PI/180;function Mr(r,e=0){let{width:t,height:i,unproject:o}=r,n={targetZ:e},s=o([0,i],n),a=o([t,i],n),l,c,f=r.fovy?.5*r.fovy*Ma:Math.atan(.5/r.altitude),u=(90-r.pitch)*Ma;return f>u-.01?(l=Pa(r,0,e),c=Pa(r,t,e)):(l=o([0,0],n),c=o([t,0],n)),[s,a,c,l]}function Pa(r,e,t){let{pixelUnprojectionMatrix:i}=r,o=Ce(i,[e,0,1,1]),n=Ce(i,[e,r.height,1,1]),a=(t*r.distanceScales.unitsPerMeter[2]-o[2])/(n[2]-o[2]),l=pe.lerp([],o,n,a),c=Y(l);return c.push(t),c}var Aa=`
layout(std140) uniform shadowUniforms {
  bool drawShadowMap;
  bool useShadowMap;
  vec4 color;
  highp int lightId;
  float lightCount;
  mat4 viewProjectionMatrix0;
  mat4 viewProjectionMatrix1;
  vec4 projectCenter0;
  vec4 projectCenter1;
} shadow;
`,Eu=`
const int max_lights = 2;

out vec3 shadow_vPosition[max_lights];

vec4 shadow_setVertexPosition(vec4 position_commonspace) {
  mat4 viewProjectionMatrices[max_lights];
  viewProjectionMatrices[0] = shadow.viewProjectionMatrix0;
  viewProjectionMatrices[1] = shadow.viewProjectionMatrix1;
  vec4 projectCenters[max_lights];
  projectCenters[0] = shadow.projectCenter0;
  projectCenters[1] = shadow.projectCenter1;

  if (shadow.drawShadowMap) {
    return project_common_position_to_clipspace(position_commonspace, viewProjectionMatrices[shadow.lightId], projectCenters[shadow.lightId]);
  }
  if (shadow.useShadowMap) {
    for (int i = 0; i < max_lights; i++) {
      if(i < int(shadow.lightCount)) {
        vec4 shadowMap_position = project_common_position_to_clipspace(position_commonspace, viewProjectionMatrices[i], projectCenters[i]);
        shadow_vPosition[i] = (shadowMap_position.xyz / shadowMap_position.w + 1.0) / 2.0;
      }
    }
  }
  return gl_Position;
}
`,Mu=`
${Aa}
${Eu}
`,Pu=`
const int max_lights = 2;
uniform sampler2D shadow_uShadowMap0;
uniform sampler2D shadow_uShadowMap1;

in vec3 shadow_vPosition[max_lights];

const vec4 bitPackShift = vec4(1.0, 255.0, 65025.0, 16581375.0);
const vec4 bitUnpackShift = 1.0 / bitPackShift;
const vec4 bitMask = vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0,  0.0);

float shadow_getShadowWeight(vec3 position, sampler2D shadowMap) {
  vec4 rgbaDepth = texture(shadowMap, position.xy);

  float z = dot(rgbaDepth, bitUnpackShift);
  return smoothstep(0.001, 0.01, position.z - z);
}

vec4 shadow_filterShadowColor(vec4 color) {
  if (shadow.drawShadowMap) {
    vec4 rgbaDepth = fract(gl_FragCoord.z * bitPackShift);
    rgbaDepth -= rgbaDepth.gbaa * bitMask;
    return rgbaDepth;
  }
  if (shadow.useShadowMap) {
    float shadowAlpha = 0.0;
    shadowAlpha += shadow_getShadowWeight(shadow_vPosition[0], shadow_uShadowMap0);
    if(shadow.lightCount > 1.0) {
      shadowAlpha += shadow_getShadowWeight(shadow_vPosition[1], shadow_uShadowMap1);
    }
    shadowAlpha *= shadow.color.a / shadow.lightCount;
    float blendedAlpha = shadowAlpha + color.a * (1.0 - shadowAlpha);

    return vec4(
      mix(color.rgb, shadow.color.rgb, shadowAlpha / blendedAlpha),
      blendedAlpha
    );
  }
  return color;
}
`,Tu=`
${Aa}
${Pu}
`,Au=fe(Ou),Cu=fe(Nu),Lu=[0,0,0,1],Ru=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,0];function Iu(r,e){let[t,i,o]=r,n=Le([t,i,o],e);return Number.isFinite(o)?n:[n[0],n[1],0]}function Ou({viewport:r,center:e}){return new O(r.viewProjectionMatrix).invert().transform(e)}function Nu({viewport:r,shadowMatrices:e}){let t=[],i=r.pixelUnprojectionMatrix,o=r.isGeospatial?void 0:1,n=[[0,0,o],[r.width,0,o],[0,r.height,o],[r.width,r.height,o],[0,0,-1],[r.width,0,-1],[0,r.height,-1],[r.width,r.height,-1]].map(s=>Iu(s,i));for(let s of e){let a=s.clone().translate(new z(r.center).negate()),l=n.map(f=>a.transform(f)),c=new O().ortho({left:Math.min(...l.map(f=>f[0])),right:Math.max(...l.map(f=>f[0])),bottom:Math.min(...l.map(f=>f[1])),top:Math.max(...l.map(f=>f[1])),near:Math.min(...l.map(f=>-f[2])),far:Math.max(...l.map(f=>-f[2]))});t.push(c.multiplyRight(s))}return t}function Uu(r){let{shadowEnabled:e=!0,project:t}=r;if(!e||!t||!r.shadowMatrices||!r.shadowMatrices.length)return{drawShadowMap:!1,useShadowMap:!1,shadow_uShadowMap0:r.dummyShadowMap,shadow_uShadowMap1:r.dummyShadowMap};let i=ht.getUniforms(t),o=Au({viewport:t.viewport,center:i.center}),n=[],s=Cu({shadowMatrices:r.shadowMatrices,viewport:t.viewport}).slice();for(let l=0;l<r.shadowMatrices.length;l++){let c=s[l],f=c.clone().translate(new z(t.viewport.center).negate());i.coordinateSystem===We("lnglat")&&i.projectionMode===j.WEB_MERCATOR?(s[l]=f,n[l]=o):(s[l]=c.clone().multiplyRight(Ru),n[l]=f.transform(o))}let a={drawShadowMap:!!r.drawToShadowMap,useShadowMap:r.shadowMaps?r.shadowMaps.length>0:!1,color:r.shadowColor||Lu,lightId:r.shadowLightId||0,lightCount:r.shadowMatrices.length,shadow_uShadowMap0:r.dummyShadowMap,shadow_uShadowMap1:r.dummyShadowMap};for(let l=0;l<s.length;l++)a[`viewProjectionMatrix${l}`]=s[l],a[`projectCenter${l}`]=n[l];for(let l=0;l<2;l++)a[`shadow_uShadowMap${l}`]=r.shadowMaps&&r.shadowMaps[l]||r.dummyShadowMap;return a}var Pr={name:"shadow",dependencies:[ht],vs:Mu,fs:Tu,inject:{"vs:DECKGL_FILTER_GL_POSITION":`
    position = shadow_setVertexPosition(geometry.position);
    `,"fs:DECKGL_FILTER_COLOR":`
    color = shadow_filterShadowColor(color);
    `},getUniforms:Uu,uniformTypes:{drawShadowMap:"f32",useShadowMap:"f32",color:"vec4<f32>",lightId:"i32",lightCount:"f32",viewProjectionMatrix0:"mat4x4<f32>",viewProjectionMatrix1:"mat4x4<f32>",projectCenter0:"vec4<f32>",projectCenter1:"vec4<f32>"}};var Du=`struct pickingUniforms {
  isActive: f32,
  isAttribute: f32,
  isHighlightActive: f32,
  useByteColors: f32,
  highlightedObjectColor: vec3<f32>,
  highlightColor: vec4<f32>,
};

@group(0) @binding(auto) var<uniform> picking: pickingUniforms;

fn picking_normalizeColor(color: vec3<f32>) -> vec3<f32> {
  return select(color, color / 255.0, picking.useByteColors > 0.5);
}

fn picking_normalizeColor4(color: vec4<f32>) -> vec4<f32> {
  return select(color, color / 255.0, picking.useByteColors > 0.5);
}

fn picking_isColorZero(color: vec3<f32>) -> bool {
  return dot(color, vec3<f32>(1.0)) < 0.00001;
}

fn picking_isColorValid(color: vec3<f32>) -> bool {
  return dot(color, vec3<f32>(1.0)) > 0.00001;
}
`,Ca={...sr,source:Du,defaultUniforms:{...sr.defaultUniforms,useByteColors:!0},inject:{"vs:DECKGL_FILTER_GL_POSITION":`
    // for picking depth values
    picking_setPickingAttribute(position.z / position.w);
  `,"vs:DECKGL_FILTER_COLOR":`
  picking_setPickingColor(geometry.pickingColor);
  `,"fs:DECKGL_FILTER_COLOR":{order:99,injection:`
  // use highlight color if this fragment belongs to the selected object.
  color = picking_filterHighlightColor(color);

  // use picking color if rendering to picking FBO.
  color = picking_filterPickingColor(color);
    `}}};var ku=[Sr],Bu=["vs:DECKGL_FILTER_SIZE(inout vec3 size, VertexGeometry geometry)","vs:DECKGL_FILTER_GL_POSITION(inout vec4 position, VertexGeometry geometry)","vs:DECKGL_FILTER_COLOR(inout vec4 color, VertexGeometry geometry)","fs:DECKGL_FILTER_COLOR(inout vec4 color, FragmentGeometry geometry)"],Vu=[];function La(r){let e=ze.getDefaultShaderAssembler();for(let i of ku)e.addDefaultModule(i);e._hookFunctions.length=0;let t=r==="glsl"?Bu:Vu;for(let i of t)e.addShaderHook(i);return e}var Re={NO_STATE:"Awaiting state",MATCHED:"Matched. State transferred from previous layer",INITIALIZED:"Initialized",AWAITING_GC:"Discarded. Awaiting garbage collection",AWAITING_FINALIZATION:"No longer matched. Awaiting garbage collection",FINALIZED:"Finalized! Awaiting garbage collection"},gt=Symbol.for("component"),J=Symbol.for("propTypes"),Tr=Symbol.for("deprecatedProps"),ge=Symbol.for("asyncPropDefaults"),ue=Symbol.for("asyncPropOriginal"),ne=Symbol.for("asyncPropResolved");var nn={};function Ra(r){nn=r}function V(r,e,t,i){M.level>0&&nn[r]&&nn[r].call(null,e,t,i)}var ti=class{constructor(e,t,i){this._loadCount=0,this._subscribers=new Set,this.id=e,this.context=i,this.setData(t)}subscribe(e){this._subscribers.add(e)}unsubscribe(e){this._subscribers.delete(e)}inUse(){return this._subscribers.size>0}delete(){}getData(){return this.isLoaded?this._error?Promise.reject(this._error):this._content:this._loader.then(()=>this.getData())}setData(e,t){if(e===this._data&&!t)return;this._data=e;let i=++this._loadCount,o=e;typeof e=="string"&&(o=Pt(e)),o instanceof Promise?(this.isLoaded=!1,this._loader=o.then(n=>{this._loadCount===i&&(this.isLoaded=!0,this._error=void 0,this._content=n)}).catch(n=>{this._loadCount===i&&(this.isLoaded=!0,this._error=n||!0)})):(this.isLoaded=!0,this._error=void 0,this._content=e);for(let n of this._subscribers)n.onChange(this.getData())}};var ii=class{constructor(e){this.protocol=e.protocol||"resource://",this._context={device:e.device,gl:e.device?.gl,resourceManager:this},this._resources={},this._consumers={},this._pruneRequest=null}contains(e){return e.startsWith(this.protocol)?!0:e in this._resources}add({resourceId:e,data:t,forceUpdate:i=!1,persistent:o=!0}){let n=this._resources[e];n?n.setData(t,i):(n=new ti(e,t,this._context),this._resources[e]=n),n.persistent=o}remove(e){let t=this._resources[e];t&&(t.delete(),delete this._resources[e])}unsubscribe({consumerId:e}){let t=this._consumers[e];if(t){for(let i in t){let o=t[i],n=this._resources[o.resourceId];n&&n.unsubscribe(o)}delete this._consumers[e],this.prune()}}subscribe({resourceId:e,onChange:t,consumerId:i,requestId:o="default"}){let{_resources:n,protocol:s}=this;e.startsWith(s)&&(e=e.replace(s,""),n[e]||this.add({resourceId:e,data:null,persistent:!1}));let a=n[e];if(this._track(i,o,a,t),a)return a.getData()}prune(){this._pruneRequest||(this._pruneRequest=setTimeout(()=>this._prune(),0))}finalize(){for(let e in this._resources)this._resources[e].delete()}_track(e,t,i,o){let n=this._consumers,s=n[e]=n[e]||{},a=s[t],l=a&&a.resourceId&&this._resources[a.resourceId];l&&(l.unsubscribe(a),this.prune()),i&&(a?(a.onChange=o,a.resourceId=i.id):a={onChange:o,resourceId:i.id},s[t]=a,i.subscribe(a))}_prune(){this._pruneRequest=null;for(let e of Object.keys(this._resources)){let t=this._resources[e];!t.persistent&&!t.inUse()&&(t.delete(),delete this._resources[e])}}};var sn=class{constructor(e={}){this._pool=[],this.opts={overAlloc:2,poolSize:100},this.setOptions(e)}setOptions(e){Object.assign(this.opts,e)}allocate(e,t,{size:i=1,type:o,padding:n=0,copy:s=!1,initialize:a=!1,maxCount:l}){let c=o||e&&e.constructor||Float32Array,f=t*i+n;if(ArrayBuffer.isView(e)){if(f<=e.length)return e;if(f*e.BYTES_PER_ELEMENT<=e.buffer.byteLength)return new c(e.buffer,0,f)}let u=1/0;l&&(u=l*i+n);let h=this._allocate(c,f,a,u);return e&&s?h.set(e):a||h.fill(0,0,4),this._release(e),h}release(e){this._release(e)}_allocate(e,t,i,o){let n=Math.max(Math.ceil(t*this.opts.overAlloc),1);n>o&&(n=o);let s=this._pool,a=e.BYTES_PER_ELEMENT*n,l=s.findIndex(c=>c.byteLength>=a);if(l>=0){let c=new e(s.splice(l,1)[0],0,n);return i&&c.fill(0),c}return new e(n)}_release(e){if(!ArrayBuffer.isView(e))return;let t=this._pool,{buffer:i}=e,{byteLength:o}=i,n=t.findIndex(s=>s.byteLength>=o);n<0?t.push(i):(n>0||t.length<this.opts.poolSize)&&t.splice(n,0,i),t.length>this.opts.poolSize&&t.shift()}},se=new sn;function bt(){return[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}function oi(r,e){let t=r%e;return t<0?e+t:t}function Oa(r){return[r[12],r[13],r[14]]}function Na(r){return{left:_t(r[3]+r[0],r[7]+r[4],r[11]+r[8],r[15]+r[12]),right:_t(r[3]-r[0],r[7]-r[4],r[11]-r[8],r[15]-r[12]),bottom:_t(r[3]+r[1],r[7]+r[5],r[11]+r[9],r[15]+r[13]),top:_t(r[3]-r[1],r[7]-r[5],r[11]-r[9],r[15]-r[13]),near:_t(r[3]+r[2],r[7]+r[6],r[11]+r[10],r[15]+r[14]),far:_t(r[3]-r[2],r[7]-r[6],r[11]-r[10],r[15]-r[14])}}var Ia=new z;function _t(r,e,t,i){Ia.set(r,e,t);let o=Ia.len();return{distance:i/o,normal:new z(-r/o,-e/o,-t/o)}}function Fu(r){return r-Math.fround(r)}var ri;function Ar(r,e){let{size:t=1,startIndex:i=0}=e,o=e.endIndex!==void 0?e.endIndex:r.length,n=(o-i)/t;ri=se.allocate(ri,n,{type:Float32Array,size:t*2});let s=i,a=0;for(;s<o;){for(let l=0;l<t;l++){let c=r[s++];ri[a+l]=c,ri[a+l+t]=Fu(c)}a+=t*2}return ri.subarray(0,n*t*2)}function Ua(r){let e=null,t=!1;for(let i of r)i&&(e?(t||(e=[[e[0][0],e[0][1]],[e[1][0],e[1][1]]],t=!0),e[0][0]=Math.min(e[0][0],i[0][0]),e[0][1]=Math.min(e[0][1],i[0][1]),e[1][0]=Math.max(e[1][0],i[1][0]),e[1][1]=Math.max(e[1][1],i[1][1])):e=i);return e}var zu=Math.PI/180,ju=bt(),Da=[0,0,0],Gu={unitsPerMeter:[1,1,1],metersPerUnit:[1,1,1]};function Hu({width:r,height:e,orthographic:t,fovyRadians:i,focalDistance:o,padding:n,near:s,far:a}){let l=r/e,c=t?new O().orthographic({fovy:i,aspect:l,focalDistance:o,near:s,far:a}):new O().perspective({fovy:i,aspect:l,near:s,far:a});if(n){let{left:f=0,right:u=0,top:h=0,bottom:p=0}=n,d=F((f+r-u)/2,0,r)-r/2,g=F((h+e-p)/2,0,e)-e/2;c[8]-=d*2/r,c[9]+=g*2/e}return c}var Cr=class r{constructor(e={}){this._frustumPlanes={},this.id=e.id||this.constructor.displayName||"viewport",this.x=e.x||0,this.y=e.y||0,this.width=e.width||1,this.height=e.height||1,this.zoom=e.zoom||0,this.padding=e.padding,this.distanceScales=e.distanceScales||Gu,this.focalDistance=e.focalDistance||1,this.position=e.position||Da,this.modelMatrix=e.modelMatrix||null;let{longitude:t,latitude:i}=e;this.isGeospatial=Number.isFinite(i)&&Number.isFinite(t),this._initProps(e),this._initMatrices(e),this.equals=this.equals.bind(this),this.project=this.project.bind(this),this.unproject=this.unproject.bind(this),this.projectPosition=this.projectPosition.bind(this),this.unprojectPosition=this.unprojectPosition.bind(this),this.projectFlat=this.projectFlat.bind(this),this.unprojectFlat=this.unprojectFlat.bind(this)}get subViewports(){return null}get metersPerPixel(){return this.distanceScales.metersPerUnit[2]/this.scale}get projectionMode(){return this.isGeospatial?this.zoom<12?j.WEB_MERCATOR:j.WEB_MERCATOR_AUTO_OFFSET:j.IDENTITY}equals(e){return e instanceof r?this===e?!0:e.width===this.width&&e.height===this.height&&e.scale===this.scale&&At(e.projectionMatrix,this.projectionMatrix)&&At(e.viewMatrix,this.viewMatrix):!1}project(e,{topLeft:t=!0}={}){let i=this.projectPosition(e),o=mt(i,this.pixelProjectionMatrix),[n,s]=o,a=t?s:this.height-s;return e.length===2?[n,a]:[n,a,o[2]]}unproject(e,{topLeft:t=!0,targetZ:i}={}){let[o,n,s]=e,a=t?n:this.height-n,l=i&&i*this.distanceScales.unitsPerMeter[2],c=Le([o,a,s],this.pixelUnprojectionMatrix,l),[f,u,h]=this.unprojectPosition(c);return Number.isFinite(s)?[f,u,h]:Number.isFinite(i)?[f,u,i]:[f,u]}projectPosition(e){let[t,i]=this.projectFlat(e),o=(e[2]||0)*this.distanceScales.unitsPerMeter[2];return[t,i,o]}unprojectPosition(e){let[t,i]=this.unprojectFlat(e),o=(e[2]||0)*this.distanceScales.metersPerUnit[2];return[t,i,o]}projectFlat(e){if(this.isGeospatial){let t=K(e);return t[1]=F(t[1],-318,830),t}return e}unprojectFlat(e){return this.isGeospatial?Y(e):e}getBounds(e={}){let t={targetZ:e.z||0},i=this.unproject([0,0],t),o=this.unproject([this.width,0],t),n=this.unproject([0,this.height],t),s=this.unproject([this.width,this.height],t);return[Math.min(i[0],o[0],n[0],s[0]),Math.min(i[1],o[1],n[1],s[1]),Math.max(i[0],o[0],n[0],s[0]),Math.max(i[1],o[1],n[1],s[1])]}getDistanceScales(e){return e&&this.isGeospatial?dt({longitude:e[0],latitude:e[1],highPrecision:!0}):this.distanceScales}containsPixel({x:e,y:t,width:i=1,height:o=1}){return e<this.x+this.width&&this.x<e+i&&t<this.y+this.height&&this.y<t+o}getFrustumPlanes(){return this._frustumPlanes.near?this._frustumPlanes:(Object.assign(this._frustumPlanes,Na(this.viewProjectionMatrix)),this._frustumPlanes)}panByPosition(e,t,i){return null}_initProps(e){let t=e.longitude,i=e.latitude;this.isGeospatial&&(Number.isFinite(e.zoom)||(this.zoom=rn({latitude:i})+Math.log2(this.focalDistance)),this.distanceScales=e.distanceScales||dt({latitude:i,longitude:t}));let o=Math.pow(2,this.zoom);this.scale=o;let{position:n,modelMatrix:s}=e,a=Da;if(n&&(a=s?new O(s).transformAsVector(n,[]):n),this.isGeospatial){let l=this.projectPosition([t,i,0]);this.center=new z(a).scale(this.distanceScales.unitsPerMeter).add(l)}else this.center=this.projectPosition(a)}_initMatrices(e){let{viewMatrix:t=ju,projectionMatrix:i=null,orthographic:o=!1,fovyRadians:n,fovy:s=75,near:a=.1,far:l=1e3,padding:c=null,focalDistance:f=1}=e;this.viewMatrixUncentered=t,this.viewMatrix=new O().multiplyRight(t).translate(new z(this.center).negate()),this.projectionMatrix=i||Hu({width:this.width,height:this.height,orthographic:o,fovyRadians:n||s*zu,focalDistance:f,padding:c,near:a,far:l});let u=bt();H.multiply(u,u,this.projectionMatrix),H.multiply(u,u,this.viewMatrix),this.viewProjectionMatrix=u,this.viewMatrixInverse=H.invert([],this.viewMatrix)||this.viewMatrix,this.cameraPosition=Oa(this.viewMatrixInverse);let h=bt(),p=bt();H.scale(h,h,[this.width/2,-this.height/2,1]),H.translate(h,h,[1,-1,0]),H.multiply(p,h,this.viewProjectionMatrix),this.pixelProjectionMatrix=p,this.pixelUnprojectionMatrix=H.invert(bt(),this.pixelProjectionMatrix),this.pixelUnprojectionMatrix||M.warn("Pixel project matrix not invertible")()}};Cr.displayName="Viewport";var vt=Cr;var Wu="layerManager.setLayers",$u="layerManager.activateViewport",ni=class{constructor(e,t){this._lastRenderedLayers=[],this._needsRedraw=!1,this._needsUpdate=!1,this._nextLayers=null,this._debug=!1,this._defaultShaderModulesChanged=!1,this.activateViewport=a=>{V($u,this,a),a&&(this.context.viewport=a)};let{deck:i,stats:o,viewport:n,timeline:s}=t||{};this.layers=[],this.resourceManager=new ii({device:e,protocol:"deck://"}),this.context={mousePosition:null,userData:{},layerManager:this,device:e,gl:e?.gl,deck:i,shaderAssembler:La(e?.info?.shadingLanguage||"glsl"),defaultShaderModules:[Ko],renderPass:void 0,stats:o||new Qe({id:"deck.gl"}),viewport:n||new vt({id:"DEFAULT-INITIAL-VIEWPORT"}),timeline:s||new ke,resourceManager:this.resourceManager,onError:void 0},Object.seal(this)}finalize(){this.resourceManager.finalize();for(let e of this.layers)this._finalizeLayer(e)}needsRedraw(e={clearRedrawFlags:!1}){let t=this._needsRedraw;e.clearRedrawFlags&&(this._needsRedraw=!1);for(let i of this.layers){let o=i.getNeedsRedraw(e);t=t||o}return t}needsUpdate(){return this._nextLayers&&this._nextLayers!==this._lastRenderedLayers?"layers changed":this._defaultShaderModulesChanged?"shader modules changed":this._needsUpdate}setNeedsRedraw(e){this._needsRedraw=this._needsRedraw||e}setNeedsUpdate(e){this._needsUpdate=this._needsUpdate||e}getLayers({layerIds:e}={}){return e?this.layers.filter(t=>e.find(i=>t.id.indexOf(i)===0)):this.layers}setProps(e){"debug"in e&&(this._debug=e.debug),"userData"in e&&(this.context.userData=e.userData),"layers"in e&&(this._nextLayers=e.layers),"onError"in e&&(this.context.onError=e.onError)}setLayers(e,t){V(Wu,this,t,e),this._lastRenderedLayers=e;let i=He(e,Boolean);for(let o of i)o.context=this.context;this._updateLayers(this.layers,i)}updateLayers(){let e=this.needsUpdate();e&&(this.setNeedsRedraw(`updating layers: ${e}`),this.setLayers(this._nextLayers||this._lastRenderedLayers,e)),this._nextLayers=null}addDefaultShaderModule(e){let{defaultShaderModules:t}=this.context;t.find(i=>i.name===e.name)||(t.push(e),this._defaultShaderModulesChanged=!0)}removeDefaultShaderModule(e){let{defaultShaderModules:t}=this.context,i=t.findIndex(o=>o.name===e.name);i>=0&&(t.splice(i,1),this._defaultShaderModulesChanged=!0)}_handleError(e,t,i){i.raiseError(t,`${e} of ${i}`)}_updateLayers(e,t){let i={};for(let s of e)i[s.id]?M.warn(`Multiple old layers with same id ${s.id}`)():i[s.id]=s;if(this._defaultShaderModulesChanged){for(let s of e)s.setNeedsUpdate(),s.setChangeFlags({extensionsChanged:!0});this._defaultShaderModulesChanged=!1}let o=[];this._updateSublayersRecursively(t,i,o),this._finalizeOldLayers(i);let n=!1;for(let s of o)if(s.hasUniformTransition()){n=`Uniform transition in ${s}`;break}this._needsUpdate=n,this.layers=o}_updateSublayersRecursively(e,t,i){for(let o of e){o.context=this.context;let n=t[o.id];n===null&&M.warn(`Multiple new layers with same id ${o.id}`)(),t[o.id]=null;let s=null;try{this._debug&&n!==o&&o.validateProps(),n?(this._transferLayerState(n,o),this._updateLayer(o)):this._initializeLayer(o),i.push(o),s=o.isComposite?o.getSubLayers():null}catch(a){this._handleError("matching",a,o)}s&&this._updateSublayersRecursively(s,t,i)}}_finalizeOldLayers(e){for(let t in e){let i=e[t];i&&this._finalizeLayer(i)}}_initializeLayer(e){try{e._initialize(),e.lifecycle=Re.INITIALIZED}catch(t){this._handleError("initialization",t,e)}}_transferLayerState(e,t){t._transferState(e),t.lifecycle=Re.MATCHED,t!==e&&(e.lifecycle=Re.AWAITING_GC)}_updateLayer(e){try{e._update()}catch(t){this._handleError("update",t,e)}}_finalizeLayer(e){this._needsRedraw=this._needsRedraw||`finalized ${e}`,e.lifecycle=Re.AWAITING_FINALIZATION;try{e._finalize(),e.lifecycle=Re.FINALIZED}catch(t){this._handleError("finalization",t,e)}}};var si=class{constructor(e){this.views=[],this.width=100,this.height=100,this.viewState={},this.controllers={},this.timeline=e.timeline,this._viewports=[],this._viewportMap={},this._isUpdating=!1,this._needsRedraw="First render",this._needsUpdate="Initialize",this._eventManager=e.eventManager,this._eventCallbacks={onViewStateChange:e.onViewStateChange,onInteractionStateChange:e.onInteractionStateChange},this._pickPosition=e.pickPosition,Object.seal(this),this.setProps(e)}finalize(){for(let e in this.controllers){let t=this.controllers[e];t&&t.finalize()}this.controllers={}}needsRedraw(e={clearRedrawFlags:!1}){let t=this._needsRedraw;return e.clearRedrawFlags&&(this._needsRedraw=!1),t}setNeedsUpdate(e){this._needsUpdate=this._needsUpdate||e,this._needsRedraw=this._needsRedraw||e}updateViewStates(){for(let e in this.controllers){let t=this.controllers[e];t&&t.updateTransition()}}getViewports(e){return e?this._viewports.filter(t=>t.containsPixel(e)):this._viewports}getViews(){let e={};return this.views.forEach(t=>{e[t.id]=t}),e}getView(e){return this.views.find(t=>t.id===e)}getViewState(e){let t=typeof e=="string"?this.getView(e):e,i=t&&this.viewState[t.getViewStateId()]||this.viewState;return t?t.filterViewState(i):i}getViewport(e){return this._viewportMap[e]}unproject(e,t){let i=this.getViewports(),o={x:e[0],y:e[1]};for(let n=i.length-1;n>=0;--n){let s=i[n];if(s.containsPixel(o)){let a=e.slice();return a[0]-=s.x,a[1]-=s.y,s.unproject(a,t)}}return null}setProps(e){e.views&&this._setViews(e.views),e.viewState&&this._setViewState(e.viewState),("width"in e||"height"in e)&&this._setSize(e.width,e.height),"pickPosition"in e&&(this._pickPosition=e.pickPosition),this._isUpdating||this._update()}_update(){this._isUpdating=!0,this._needsUpdate&&(this._needsUpdate=!1,this._rebuildViewports()),this._needsUpdate&&(this._needsUpdate=!1,this._rebuildViewports()),this._isUpdating=!1}_setSize(e,t){(e!==this.width||t!==this.height)&&(this.width=e,this.height=t,this.setNeedsUpdate("Size changed"))}_setViews(e){e=He(e,Boolean),this._diffViews(e,this.views)&&this.setNeedsUpdate("views changed"),this.views=e}_setViewState(e){e?(!B(e,this.viewState,3)&&this.setNeedsUpdate("viewState changed"),this.viewState=e):M.warn("missing `viewState` or `initialViewState`")()}_createController(e,t){let i=t.type;return new i({timeline:this.timeline,eventManager:this._eventManager,onViewStateChange:this._eventCallbacks.onViewStateChange,onStateChange:this._eventCallbacks.onInteractionStateChange,makeViewport:n=>this.getView(e.id)?.makeViewport({viewState:n,width:this.width,height:this.height}),pickPosition:this._pickPosition})}_updateController(e,t,i,o){let n=e.controller;if(n&&i){let s={...t,...n,id:e.id,x:i.x,y:i.y,width:i.width,height:i.height};return(!o||o.constructor!==n.type)&&(o=this._createController(e,s)),o&&o.setProps(s),o}return null}_rebuildViewports(){let{views:e}=this,t=this.controllers;this._viewports=[],this.controllers={};let i=!1;for(let o=e.length;o--;){let n=e[o],s=this.getViewState(n),a=n.makeViewport({viewState:s,width:this.width,height:this.height}),l=t[n.id],c=!!n.controller;c&&!l&&(i=!0),(i||!c)&&l&&(l.finalize(),l=null),this.controllers[n.id]=this._updateController(n,s,a,l),a&&this._viewports.unshift(a)}for(let o in t){let n=t[o];n&&!this.controllers[o]&&n.finalize()}this._buildViewportMap()}_buildViewportMap(){this._viewportMap={},this._viewports.forEach(e=>{e.id&&(this._viewportMap[e.id]=this._viewportMap[e.id]||e)})}_diffViews(e,t){return e.length!==t.length?!0:e.some((i,o)=>!e[o].equals(t[o]))}};var Yu=/^(?:\d+\.?\d*|\.\d+)$/;function _e(r){switch(typeof r){case"number":if(!Number.isFinite(r))throw new Error(`Could not parse position string ${r}`);return{type:"literal",value:r};case"string":try{let e=qu(r);return new ln(e).parseExpression()}catch(e){let t=e instanceof Error?e.message:String(e);throw new Error(`Could not parse position string ${r}: ${t}`)}default:throw new Error(`Could not parse position string ${r}`)}}function an(r,e){switch(r.type){case"literal":return r.value;case"percentage":return Math.round(r.value*e);case"binary":let t=an(r.left,e),i=an(r.right,e);return r.operator==="+"?t+i:t-i;default:throw new Error("Unknown layout expression type")}}function be(r,e){return an(r,e)}function qu(r){let e=[],t=0;for(;t<r.length;){let i=r[t];if(/\s/.test(i)){t++;continue}if(i==="+"||i==="-"||i==="("||i===")"||i==="%"){e.push({type:"symbol",value:i}),t++;continue}if(ka(i)||i==="."){let o=t,n=i===".";for(t++;t<r.length;){let a=r[t];if(ka(a)){t++;continue}if(a==="."&&!n){n=!0,t++;continue}break}let s=r.slice(o,t);if(!Yu.test(s))throw new Error("Invalid number token");e.push({type:"number",value:parseFloat(s)});continue}if(Ba(i)){let o=t;for(;t<r.length&&Ba(r[t]);)t++;let n=r.slice(o,t).toLowerCase();e.push({type:"word",value:n});continue}throw new Error("Invalid token in position string")}return e}var ln=class{constructor(e){this.index=0,this.tokens=e}parseExpression(){let e=this.parseBinaryExpression();if(this.index<this.tokens.length)throw new Error("Unexpected token at end of expression");return e}parseBinaryExpression(){let e=this.parseFactor(),t=this.peek();for(;Xu(t);){this.index++;let i=this.parseFactor();e={type:"binary",operator:t.value,left:e,right:i},t=this.peek()}return e}parseFactor(){let e=this.peek();if(!e)throw new Error("Unexpected end of expression");if(e.type==="symbol"&&e.value==="+")return this.index++,this.parseFactor();if(e.type==="symbol"&&e.value==="-"){this.index++;let t=this.parseFactor();return{type:"binary",operator:"-",left:{type:"literal",value:0},right:t}}if(e.type==="symbol"&&e.value==="("){this.index++;let t=this.parseBinaryExpression();if(!this.consumeSymbol(")"))throw new Error("Missing closing parenthesis");return t}if(e.type==="word"&&e.value==="calc"){if(this.index++,!this.consumeSymbol("("))throw new Error("Missing opening parenthesis after calc");let t=this.parseBinaryExpression();if(!this.consumeSymbol(")"))throw new Error("Missing closing parenthesis");return t}if(e.type==="number"){this.index++;let t=e.value,i=this.peek();return i&&i.type==="symbol"&&i.value==="%"?(this.index++,{type:"percentage",value:t/100}):i&&i.type==="word"&&i.value==="px"?(this.index++,{type:"literal",value:t}):{type:"literal",value:t}}throw new Error("Unexpected token in expression")}consumeSymbol(e){let t=this.peek();return t&&t.type==="symbol"&&t.value===e?(this.index++,!0):!1}peek(){return this.tokens[this.index]||null}};function ka(r){return r>="0"&&r<="9"}function Ba(r){return r>="a"&&r<="z"||r>="A"&&r<="Z"}function Xu(r){return!!(r&&r.type==="symbol"&&(r.value==="+"||r.value==="-"))}function Va(r,e){let t={...r};for(let i in e)i!=="id"&&(Array.isArray(t[i])&&Array.isArray(e[i])?t[i]=Zu(t[i],e[i]):t[i]=e[i]);return t}function Zu(r,e){r=r.slice();for(let t=0;t<e.length;t++){let i=e[t];Number.isFinite(i)&&(r[t]=i)}return r}var Ye=class{constructor(e){let{id:t,x:i=0,y:o=0,width:n="100%",height:s="100%",padding:a=null}=e;this.id=t||this.constructor.displayName||"view",this.props={...e,id:this.id},this._x=_e(i),this._y=_e(o),this._width=_e(n),this._height=_e(s),this._padding=a&&{left:_e(a.left||0),right:_e(a.right||0),top:_e(a.top||0),bottom:_e(a.bottom||0)},this.equals=this.equals.bind(this),Object.seal(this)}equals(e){return this===e?!0:this.constructor===e.constructor&&B(this.props,e.props,2)}clone(e){let t=this.constructor;return new t({...this.props,...e})}makeViewport({width:e,height:t,viewState:i}){i=this.filterViewState(i);let o=this.getDimensions({width:e,height:t});if(!o.height||!o.width)return null;let n=this.getViewportType(i);return new n({...i,...this.props,...o})}getViewStateId(){let{viewState:e}=this.props;return typeof e=="string"?e:e?.id||this.id}filterViewState(e){return this.props.viewState&&typeof this.props.viewState=="object"?this.props.viewState.id?Va(e,this.props.viewState):this.props.viewState:e}getDimensions({width:e,height:t}){let i={x:be(this._x,e),y:be(this._y,t),width:be(this._width,e),height:be(this._height,t)};return this._padding&&(i.padding={left:be(this._padding.left,e),top:be(this._padding.top,t),right:be(this._padding.right,e),bottom:be(this._padding.bottom,t)}),i}get controller(){let e=this.props.controller;return e?e===!0?{type:this.ControllerType}:typeof e=="function"?{type:e}:{type:this.ControllerType,...e}:null}};var Lr=class r extends vt{constructor(e={}){let{latitude:t=0,longitude:i=0,zoom:o=0,pitch:n=0,bearing:s=0,nearZMultiplier:a=.1,farZMultiplier:l=1.01,nearZ:c,farZ:f,orthographic:u=!1,projectionMatrix:h,repeat:p=!1,worldOffset:d=0,position:g,padding:b,legacyMeterSizes:v=!1}=e,{width:y,height:_,altitude:S=1.5}=e,P=Math.pow(2,o);y=y||1,_=_||1;let x,E=null;if(h)S=h[5]/2,x=me(S);else{e.fovy?(x=e.fovy,S=$e(x)):x=me(S);let T;if(b){let{top:A=0,bottom:W=0}=b;T=[0,F((A+_-W)/2,0,_)-_/2]}E=on({width:y,height:_,scale:P,center:g&&[0,0,g[2]*Qt(t)],offset:T,pitch:n,fovy:x,nearZMultiplier:a,farZMultiplier:l}),Number.isFinite(c)&&(E.near=c),Number.isFinite(f)&&(E.far=f)}let C=wr({height:_,pitch:n,bearing:s,scale:P,altitude:S});d&&(C=new O().translate([512*d,0,0]).multiplyLeft(C)),super({...e,width:y,height:_,viewMatrix:C,longitude:i,latitude:t,zoom:o,...E,fovy:x,focalDistance:S}),this.latitude=t,this.longitude=i,this.zoom=o,this.pitch=n,this.bearing=s,this.altitude=S,this.fovy=x,this.orthographic=u,this._subViewports=p?[]:null,this._pseudoMeters=v,Object.freeze(this)}get subViewports(){if(this._subViewports&&!this._subViewports.length){let e=this.getBounds(),t=Math.floor((e[0]+180)/360),i=Math.ceil((e[2]-180)/360);for(let o=t;o<=i;o++){let n=o?new r({...this,worldOffset:o}):this;this._subViewports.push(n)}}return this._subViewports}projectPosition(e){if(this._pseudoMeters)return super.projectPosition(e);let[t,i]=this.projectFlat(e),o=(e[2]||0)*Qt(e[1]);return[t,i,o]}unprojectPosition(e){if(this._pseudoMeters)return super.unprojectPosition(e);let[t,i]=this.unprojectFlat(e),o=(e[2]||0)/Qt(i);return[t,i,o]}addMetersToLngLat(e,t){return ei(e,t)}panByPosition(e,t,i){let o=Le(t,this.pixelUnprojectionMatrix),n=this.projectFlat(e),s=pe.add([],n,pe.negate([],o)),a=pe.add([],this.center,s),[l,c]=this.unprojectFlat(a);return{longitude:l,latitude:c}}panByPosition3D(e,t){let i=e[2]||0,o=pe.sub([],e,this.unproject(t,{targetZ:i}));return{longitude:this.longitude+o[0],latitude:this.latitude+o[1]}}getBounds(e={}){let t=Mr(this,e.z||0);return[Math.min(t[0][0],t[1][0],t[2][0],t[3][0]),Math.min(t[0][1],t[1][1],t[2][1],t[3][1]),Math.max(t[0][0],t[1][0],t[2][0],t[3][0]),Math.max(t[0][1],t[1][1],t[2][1],t[3][1])]}fitBounds(e,t={}){let{width:i,height:o}=this,{longitude:n,latitude:s,zoom:a}=Er({width:i,height:o,bounds:e,...t});return new r({width:i,height:o,longitude:n,latitude:s,zoom:a})}};Lr.displayName="WebMercatorViewport";var qe=Lr;var ae=class{constructor(e){this._inProgress=!1,this._handle=null,this.time=0,this.settings={duration:0},this._timeline=e}get inProgress(){return this._inProgress}start(e){this.cancel(),this.settings=e,this._inProgress=!0,this.settings.onStart?.(this)}end(){this._inProgress&&(this._timeline.removeChannel(this._handle),this._handle=null,this._inProgress=!1,this.settings.onEnd?.(this))}cancel(){this._inProgress&&(this.settings.onInterrupt?.(this),this._timeline.removeChannel(this._handle),this._handle=null,this._inProgress=!1)}update(){if(!this._inProgress)return!1;if(this._handle===null){let{_timeline:e,settings:t}=this;this._handle=e.addChannel({delay:e.getTime(),duration:t.duration})}return this.time=this._timeline.getTime(this._handle),this._onUpdate(),this.settings.onUpdate?.(this),this._timeline.isFinished(this._handle)&&this.end(),!0}_onUpdate(){}};var Fa=()=>{},cn={BREAK:1,SNAP_TO_END:2,IGNORE:3},Ku=r=>r,Ju=cn.BREAK,ai=class{constructor(e){this._onTransitionUpdate=t=>{let{time:i,settings:{interpolator:o,startProps:n,endProps:s,duration:a,easing:l}}=t,c=l(i/a),f=o.interpolateProps(n,s,c);this.propsInTransition=this.getControllerState({...this.props,...f}).getViewportProps(),this.onViewStateChange({viewState:this.propsInTransition,oldViewState:this.props})},this.getControllerState=e.getControllerState,this.propsInTransition=null,this.transition=new ae(e.timeline),this.onViewStateChange=e.onViewStateChange||Fa,this.onStateChange=e.onStateChange||Fa}finalize(){this.transition.cancel()}getViewportInTransition(){return this.propsInTransition}processViewStateChange(e){let t=!1,i=this.props;if(this.props=e,!i||this._shouldIgnoreViewportChange(i,e))return!1;if(this._isTransitionEnabled(e)){let o=i;if(this.transition.inProgress){let{interruption:n,endProps:s}=this.transition.settings;o={...i,...n===cn.SNAP_TO_END?s:this.propsInTransition||i}}this._triggerTransition(o,e),t=!0}else this.transition.cancel();return t}updateTransition(){this.transition.update()}_isTransitionEnabled(e){let{transitionDuration:t,transitionInterpolator:i}=e;return(t>0||t==="auto")&&!!i}_isUpdateDueToCurrentTransition(e){return this.transition.inProgress&&this.propsInTransition?this.transition.settings.interpolator.arePropsEqual(e,this.propsInTransition):!1}_shouldIgnoreViewportChange(e,t){return this.transition.inProgress?this.transition.settings.interruption===cn.IGNORE||this._isUpdateDueToCurrentTransition(t):this._isTransitionEnabled(t)?t.transitionInterpolator.arePropsEqual(e,t):!0}_triggerTransition(e,t){let i=this.getControllerState(e),o=this.getControllerState(t).shortestPathFrom(i),n=t.transitionInterpolator,s=n.getDuration?n.getDuration(e,t):t.transitionDuration;if(s===0)return;let a=n.initializeProps(e,o);this.propsInTransition={};let l={duration:s,easing:t.transitionEasing||Ku,interpolator:n,interruption:t.transitionInterruption||Ju,startProps:a.start,endProps:a.end,onStart:t.onTransitionStart,onUpdate:this._onTransitionUpdate,onInterrupt:this._onTransitionEnd(t.onTransitionInterrupt),onEnd:this._onTransitionEnd(t.onTransitionEnd)};this.transition.start(l),this.onStateChange({inTransition:!0}),this.updateTransition()}_onTransitionEnd(e){return t=>{this.propsInTransition=null,this.onStateChange({inTransition:!1,isZooming:!1,isPanning:!1,isRotating:!1}),e?.(t)}}};var li=class{constructor(e){let{compare:t,extract:i,required:o}=e;this._propsToCompare=t,this._propsToExtract=i||t,this._requiredProps=o}arePropsEqual(e,t){for(let i of this._propsToCompare)if(!(i in e)||!(i in t)||!At(e[i],t[i]))return!1;return!0}initializeProps(e,t){let i={},o={};for(let n of this._propsToExtract)(n in e||n in t)&&(i[n]=e[n],o[n]=t[n]);return this._checkRequiredProps(i),this._checkRequiredProps(o),{start:i,end:o}}getDuration(e,t){return t.transitionDuration}_checkRequiredProps(e){this._requiredProps&&this._requiredProps.forEach(t=>{let i=e[t];N(Number.isFinite(i)||Array.isArray(i),`${t} is required for transition`)})}};var Rr=Math.PI/180,za=180/Math.PI,Ir=6370972,ve=256;function Qu(){let r=ve/Ir,e=Math.PI/180*ve;return{unitsPerMeter:[r,r,r],unitsPerMeter2:[0,0,0],metersPerUnit:[1/r,1/r,1/r],unitsPerDegree:[e,e,r],unitsPerDegree2:[0,0,0],degreesPerUnit:[1/e,1/e,1/r]}}var Or=class extends vt{constructor(e={}){let{longitude:t=0,zoom:i=0,nearZMultiplier:o=.5,farZMultiplier:n=1,resolution:s=10}=e,{latitude:a=0,height:l,altitude:c=1.5,fovy:f}=e;a=Math.max(Math.min(a,$),-$),l=l||1,f?c=$e(f):f=me(c);let u=Math.pow(2,i-he(a)),h=e.nearZ??o,p=e.farZ??(c+ve*2*u/l)*n,d=new O().lookAt({eye:[0,-c,0],up:[0,0,1]});d.rotateX(a*Rr),d.rotateZ(-t*Rr),d.scale(u/l),super({...e,height:l,viewMatrix:d,longitude:t,latitude:a,zoom:i,distanceScales:Qu(),fovy:f,focalDistance:c,near:h,far:p}),this.scale=u,this.latitude=a,this.longitude=t,this.fovy=f,this.resolution=s}get projectionMode(){return j.GLOBE}getDistanceScales(){return this.distanceScales}getBounds(e={}){let t={targetZ:e.z||0},i=this.unproject([0,this.height/2],t),o=this.unproject([this.width/2,0],t),n=this.unproject([this.width,this.height/2],t),s=this.unproject([this.width/2,this.height],t);return n[0]<this.longitude&&(n[0]+=360),i[0]>this.longitude&&(i[0]-=360),[Math.min(i[0],n[0],o[0],s[0]),Math.min(i[1],n[1],o[1],s[1]),Math.max(i[0],n[0],o[0],s[0]),Math.max(i[1],n[1],o[1],s[1])]}unproject(e,{topLeft:t=!0,targetZ:i}={}){let[o,n,s]=e,a=t?n:this.height-n,{pixelUnprojectionMatrix:l}=this,c;if(Number.isFinite(s))c=fn(l,[o,a,s,1]);else{let p=fn(l,[o,a,-1,1]),d=fn(l,[o,a,1,1]),g=((i||0)/Ir+1)*ve,b=ee.sqrLen(ee.sub([],p,d)),v=ee.sqrLen(p),y=ee.sqrLen(d),S=4*((4*v*y-(b-v-y)**2)/16)/b,P=Math.sqrt(v-S),x=Math.sqrt(Math.max(0,g*g-S)),E=(P-x)/Math.sqrt(b);c=ee.lerp([],p,d,E)}let[f,u,h]=this.unprojectPosition(c);return Number.isFinite(s)?[f,u,h]:Number.isFinite(i)?[f,u,i]:[f,u]}projectPosition(e){let[t,i,o=0]=e,n=t*Rr,s=i*Rr,a=Math.cos(s),l=(o/Ir+1)*ve;return[Math.sin(n)*a*l,-Math.cos(n)*a*l,Math.sin(s)*l]}unprojectPosition(e){let[t,i,o]=e,n=ee.len(e),s=Math.asin(o/n),l=Math.atan2(t,-i)*za,c=s*za,f=(n/ve-1)*Ir;return[l,c,f]}projectFlat(e){return e}unprojectFlat(e){return e}panByPosition([e,t,i],o,n){let a=.25/Math.pow(2,this.zoom-he(this.latitude)),l=e+a*(n[0]-o[0]),c=t-a*(n[1]-o[1]);c=Math.max(Math.min(c,$),-$);let f={longitude:l,latitude:c,zoom:i-he(t)};return f.zoom+=he(f.latitude),f}};Or.displayName="GlobeViewport";var ci=Or;function he(r){let e=Math.PI*Math.cos(r*Math.PI/180);return Math.log2(e)}function fn(r,e){let t=te.transformMat4([],e,r);return te.scale(t,t,1/t[3]),t}var eh=["longitude","latitude","zoom","bearing","pitch"],th=["longitude","latitude","zoom"],ye=class extends li{constructor(e={}){let t=Array.isArray(e)?e:e.transitionProps,i=Array.isArray(e)?{}:e;i.transitionProps=Array.isArray(t)?{compare:t,required:t}:t||{compare:eh,required:th},super(i.transitionProps),this.opts=i}initializeProps(e,t){let i=super.initializeProps(e,t),{makeViewport:o,around:n}=this.opts;if(o&&n)if(o(e)instanceof ci)M.warn("around not supported in GlobeView")();else{let a=o(e),l=o(t),c=a.unproject(n);i.start.around=n,Object.assign(i.end,{around:l.project(c),aroundPosition:c,width:t.width,height:t.height})}return i}interpolateProps(e,t,i){let o={};for(let n of this._propsToExtract)o[n]=Tt(e[n]||0,t[n]||0,i);if(t.aroundPosition&&this.opts.makeViewport){let n=this.opts.makeViewport({...t,...o});Object.assign(o,n.panByPosition(t.aroundPosition,Tt(e.around,t.around,i)))}return o}};var Se={transitionDuration:0},ih=300,Nr=r=>1-(1-r)*(1-r),yt={WHEEL:["wheel"],PAN:["panstart","panmove","panend"],PINCH:["pinchstart","pinchmove","pinchend"],MULTI_PAN:["multipanstart","multipanmove","multipanend"],DOUBLE_CLICK:["dblclick"],KEYBOARD:["keydown"]},Xe={},Ze=class{constructor(e){this.state={},this._events={},this._interactionState={isDragging:!1},this._customEvents=[],this._eventStartBlocked=null,this._panMove=!1,this.invertPan=!1,this.dragMode="rotate",this.inertia=0,this.scrollZoom=!0,this.dragPan=!0,this.dragRotate=!0,this.doubleClickZoom=!0,this.touchZoom=!0,this.touchRotate=!1,this.keyboard=!0,this.transitionManager=new ai({...e,getControllerState:t=>new this.ControllerState(t),onViewStateChange:this._onTransition.bind(this),onStateChange:this._setInteractionState.bind(this)}),this.handleEvent=this.handleEvent.bind(this),this.eventManager=e.eventManager,this.onViewStateChange=e.onViewStateChange||(()=>{}),this.onStateChange=e.onStateChange||(()=>{}),this.makeViewport=e.makeViewport,this.pickPosition=e.pickPosition}set events(e){this.toggleEvents(this._customEvents,!1),this.toggleEvents(e,!0),this._customEvents=e,this.props&&this.setProps(this.props)}finalize(){for(let e in this._events)this._events[e]&&this.eventManager?.off(e,this.handleEvent);this.transitionManager.finalize()}handleEvent(e){this._controllerState=void 0;let t=this._eventStartBlocked;switch(e.type){case"panstart":return t?!1:this._onPanStart(e);case"panmove":return this._onPan(e);case"panend":return this._onPanEnd(e);case"pinchstart":return t?!1:this._onPinchStart(e);case"pinchmove":return this._onPinch(e);case"pinchend":return this._onPinchEnd(e);case"multipanstart":return t?!1:this._onMultiPanStart(e);case"multipanmove":return this._onMultiPan(e);case"multipanend":return this._onMultiPanEnd(e);case"dblclick":return this._onDoubleClick(e);case"wheel":return this._onWheel(e);case"keydown":return this._onKeyDown(e);default:return!1}}get controllerState(){return this._controllerState=this._controllerState||new this.ControllerState({makeViewport:this.makeViewport,...this.props,...this.state}),this._controllerState}getCenter(e){let{x:t,y:i}=this.props,{offsetCenter:o}=e;return[o.x-t,o.y-i]}isPointInBounds(e,t){let{width:i,height:o}=this.props;if(t&&t.handled)return!1;let n=e[0]>=0&&e[0]<=i&&e[1]>=0&&e[1]<=o;return n&&t&&t.stopPropagation(),n}isFunctionKeyPressed(e){let{srcEvent:t}=e;return!!(t.metaKey||t.altKey||t.ctrlKey||t.shiftKey)}isDragging(){return this._interactionState.isDragging||!1}blockEvents(e){let t=setTimeout(()=>{this._eventStartBlocked===t&&(this._eventStartBlocked=null)},e);this._eventStartBlocked=t}setProps(e){e.dragMode&&(this.dragMode=e.dragMode);let t=this.props;this.props=e,"transitionInterpolator"in e||(e.transitionInterpolator=this._getTransitionProps().transitionInterpolator),this.transitionManager.processViewStateChange(e);let{inertia:i}=e;this.inertia=Number.isFinite(i)?i:i===!0?ih:0;let{scrollZoom:o=!0,dragPan:n=!0,dragRotate:s=!0,doubleClickZoom:a=!0,touchZoom:l=!0,touchRotate:c=!1,keyboard:f=!0}=e,u=!!this.onViewStateChange;if(this.toggleEvents(yt.WHEEL,u&&o),this.toggleEvents(yt.PAN,u),this.toggleEvents(yt.PINCH,u&&(l||c)),this.toggleEvents(yt.MULTI_PAN,u&&c),this.toggleEvents(yt.DOUBLE_CLICK,u&&a),this.toggleEvents(yt.KEYBOARD,u&&f),this.scrollZoom=o,this.dragPan=n,this.dragRotate=s,this.doubleClickZoom=a,this.touchZoom=l,this.touchRotate=c,this.keyboard=f,(!t||t.height!==e.height||t.width!==e.width||t.maxBounds!==e.maxBounds)&&e.maxBounds){let p=new this.ControllerState({...e,makeViewport:this.makeViewport}),d=p.getViewportProps();Object.keys(d).some(b=>!B(d[b],e[b],1))&&this.updateViewport(p)}}updateTransition(){this.transitionManager.updateTransition()}toggleEvents(e,t){this.eventManager&&e.forEach(i=>{this._events[i]!==t&&(this._events[i]=t,t?this.eventManager.on(i,this.handleEvent):this.eventManager.off(i,this.handleEvent))})}updateViewport(e,t=null,i={}){let o={...e.getViewportProps(),...t},n=this.controllerState!==e;if(this.state=e.getState(),this._setInteractionState(i),n){let s=this.controllerState&&this.controllerState.getViewportProps();this.onViewStateChange&&this.onViewStateChange({viewState:o,interactionState:this._interactionState,oldViewState:s,viewId:this.props.id})}}_onTransition(e){this.onViewStateChange({...e,interactionState:this._interactionState,viewId:this.props.id})}_setInteractionState(e){Object.assign(this._interactionState,e),this.onStateChange(this._interactionState)}_onPanStart(e){let t=this.getCenter(e);if(!this.isPointInBounds(t,e))return!1;let i=this.isFunctionKeyPressed(e)||e.rightButton||!1;(this.invertPan||this.dragMode==="pan")&&(i=!i);let o=this.controllerState[i?"panStart":"rotateStart"]({pos:t});return this._panMove=i,this.updateViewport(o,Se,{isDragging:!0}),!0}_onPan(e){return this.isDragging()?this._panMove?this._onPanMove(e):this._onPanRotate(e):!1}_onPanEnd(e){return this.isDragging()?this._panMove?this._onPanMoveEnd(e):this._onPanRotateEnd(e):!1}_onPanMove(e){if(!this.dragPan)return!1;let t=this.getCenter(e),i=this.controllerState.pan({pos:t});return this.updateViewport(i,Se,{isDragging:!0,isPanning:!0}),!0}_onPanMoveEnd(e){let{inertia:t}=this;if(this.dragPan&&t&&e.velocity){let i=this.getCenter(e),o=[i[0]+e.velocityX*t/2,i[1]+e.velocityY*t/2],n=this.controllerState.pan({pos:o}).panEnd();this.updateViewport(n,{...this._getTransitionProps(),transitionDuration:t,transitionEasing:Nr},{isDragging:!1,isPanning:!0})}else{let i=this.controllerState.panEnd();this.updateViewport(i,null,{isDragging:!1,isPanning:!1})}return!0}_onPanRotate(e){if(!this.dragRotate)return!1;let t=this.getCenter(e),i=this.controllerState.rotate({pos:t});return this.updateViewport(i,Se,{isDragging:!0,isRotating:!0}),!0}_onPanRotateEnd(e){let{inertia:t}=this;if(this.dragRotate&&t&&e.velocity){let i=this.getCenter(e),o=[i[0]+e.velocityX*t/2,i[1]+e.velocityY*t/2],n=this.controllerState.rotate({pos:o}).rotateEnd();this.updateViewport(n,{...this._getTransitionProps(),transitionDuration:t,transitionEasing:Nr},{isDragging:!1,isRotating:!0})}else{let i=this.controllerState.rotateEnd();this.updateViewport(i,null,{isDragging:!1,isRotating:!1})}return!0}_onWheel(e){if(!this.scrollZoom)return!1;let t=this.getCenter(e);if(!this.isPointInBounds(t,e))return!1;e.srcEvent.preventDefault();let{speed:i=.01,smooth:o=!1}=this.scrollZoom===!0?{}:this.scrollZoom,{delta:n}=e,s=2/(1+Math.exp(-Math.abs(n*i)));n<0&&s!==0&&(s=1/s);let a=o?{...this._getTransitionProps({around:t}),transitionDuration:250}:Se,l=this.controllerState.zoom({pos:t,scale:s});return this.updateViewport(l,a,{isZooming:!0,isPanning:!0}),o||this._setInteractionState({isZooming:!1,isPanning:!1}),!0}_onMultiPanStart(e){let t=this.getCenter(e);if(!this.isPointInBounds(t,e))return!1;let i=this.controllerState.rotateStart({pos:t});return this.updateViewport(i,Se,{isDragging:!0}),!0}_onMultiPan(e){if(!this.touchRotate||!this.isDragging())return!1;let t=this.getCenter(e);t[0]-=e.deltaX;let i=this.controllerState.rotate({pos:t});return this.updateViewport(i,Se,{isDragging:!0,isRotating:!0}),!0}_onMultiPanEnd(e){if(!this.isDragging())return!1;let{inertia:t}=this;if(this.touchRotate&&t&&e.velocityY){let i=this.getCenter(e),o=[i[0],i[1]+=e.velocityY*t/2],n=this.controllerState.rotate({pos:o});this.updateViewport(n,{...this._getTransitionProps(),transitionDuration:t,transitionEasing:Nr},{isDragging:!1,isRotating:!0}),this.blockEvents(t)}else{let i=this.controllerState.rotateEnd();this.updateViewport(i,null,{isDragging:!1,isRotating:!1})}return!0}_onPinchStart(e){let t=this.getCenter(e);if(!this.isPointInBounds(t,e))return!1;let i=this.controllerState.zoomStart({pos:t}).rotateStart({pos:t});return Xe._startPinchRotation=e.rotation,Xe._lastPinchEvent=e,this.updateViewport(i,Se,{isDragging:!0}),!0}_onPinch(e){if(!this.touchZoom&&!this.touchRotate||!this.isDragging())return!1;let t=this.controllerState;if(this.touchZoom){let{scale:i}=e,o=this.getCenter(e);t=t.zoom({pos:o,scale:i})}if(this.touchRotate){let{rotation:i}=e;t=t.rotate({deltaAngleX:Xe._startPinchRotation-i})}return this.updateViewport(t,Se,{isDragging:!0,isPanning:this.touchZoom,isZooming:this.touchZoom,isRotating:this.touchRotate}),Xe._lastPinchEvent=e,!0}_onPinchEnd(e){if(!this.isDragging())return!1;let{inertia:t}=this,{_lastPinchEvent:i}=Xe;if(this.touchZoom&&t&&i&&e.scale!==i.scale){let o=this.getCenter(e),n=this.controllerState.rotateEnd(),s=Math.log2(e.scale),a=(s-Math.log2(i.scale))/(e.deltaTime-i.deltaTime),l=Math.pow(2,s+a*t/2);n=n.zoom({pos:o,scale:l}).zoomEnd(),this.updateViewport(n,{...this._getTransitionProps({around:o}),transitionDuration:t,transitionEasing:Nr},{isDragging:!1,isPanning:this.touchZoom,isZooming:this.touchZoom,isRotating:!1}),this.blockEvents(t)}else{let o=this.controllerState.zoomEnd().rotateEnd();this.updateViewport(o,null,{isDragging:!1,isPanning:!1,isZooming:!1,isRotating:!1})}return Xe._startPinchRotation=null,Xe._lastPinchEvent=null,!0}_onDoubleClick(e){if(!this.doubleClickZoom)return!1;let t=this.getCenter(e);if(!this.isPointInBounds(t,e))return!1;let i=this.isFunctionKeyPressed(e),o=this.controllerState.zoom({pos:t,scale:i?.5:2});return this.updateViewport(o,this._getTransitionProps({around:t}),{isZooming:!0,isPanning:!0}),this.blockEvents(100),!0}_onKeyDown(e){if(!this.keyboard)return!1;let t=this.isFunctionKeyPressed(e),{zoomSpeed:i,moveSpeed:o,rotateSpeedX:n,rotateSpeedY:s}=this.keyboard===!0?{}:this.keyboard,{controllerState:a}=this,l,c={};switch(e.srcEvent.code){case"Minus":l=t?a.zoomOut(i).zoomOut(i):a.zoomOut(i),c.isZooming=!0;break;case"Equal":l=t?a.zoomIn(i).zoomIn(i):a.zoomIn(i),c.isZooming=!0;break;case"ArrowLeft":t?(l=a.rotateLeft(n),c.isRotating=!0):(l=a.moveLeft(o),c.isPanning=!0);break;case"ArrowRight":t?(l=a.rotateRight(n),c.isRotating=!0):(l=a.moveRight(o),c.isPanning=!0);break;case"ArrowUp":t?(l=a.rotateUp(s),c.isRotating=!0):(l=a.moveUp(o),c.isPanning=!0);break;case"ArrowDown":t?(l=a.rotateDown(s),c.isRotating=!0):(l=a.moveDown(o),c.isPanning=!0);break;default:return!1}return this.updateViewport(l,this._getTransitionProps(),c),!0}_getTransitionProps(e){let{transition:t}=this;return!t||!t.transitionInterpolator?Se:e?{...t,transitionInterpolator:new ye({...e,...t.transitionInterpolator.opts,makeViewport:this.controllerState.makeViewport})}:t}};var fi=class{constructor(e,t,i){this.makeViewport=i,this._viewportProps=this.applyConstraints(e),this._state=t}getViewportProps(){return this._viewportProps}getState(){return this._state}};var ja=5,rh=1.2,Ga=512,Ha=[[-1/0,-90],[1/0,90]];function Ur([r,e]){if(Math.abs(e)>90&&(e=Math.sign(e)*90),Number.isFinite(r)){let[i,o]=K([r,e]);return[i,F(o,0,Ga)]}let[,t]=K([0,e]);return[r,F(t,0,Ga)]}var ui=class extends fi{constructor(e){let{width:t,height:i,latitude:o,longitude:n,zoom:s,bearing:a=0,pitch:l=0,altitude:c=1.5,position:f=[0,0,0],maxZoom:u=20,minZoom:h=0,maxPitch:p=60,minPitch:d=0,startPanLngLat:g,startZoomLngLat:b,startRotatePos:v,startRotateLngLat:y,startBearing:_,startPitch:S,startZoom:P,normalize:x=!0}=e;N(Number.isFinite(n)),N(Number.isFinite(o)),N(Number.isFinite(s));let E=e.maxBounds||(x?Ha:null);super({width:t,height:i,latitude:o,longitude:n,zoom:s,bearing:a,pitch:l,altitude:c,maxZoom:u,minZoom:h,maxPitch:p,minPitch:d,normalize:x,position:f,maxBounds:E},{startPanLngLat:g,startZoomLngLat:b,startRotatePos:v,startRotateLngLat:y,startBearing:_,startPitch:S,startZoom:P},e.makeViewport),this.getAltitude=e.getAltitude}panStart({pos:e}){return this._getUpdatedState({startPanLngLat:this._unproject(e)})}pan({pos:e,startPos:t}){let i=this.getState().startPanLngLat||this._unproject(t);if(!i)return this;let n=this.makeViewport(this.getViewportProps()).panByPosition(i,e);return this._getUpdatedState(n)}panEnd(){return this._getUpdatedState({startPanLngLat:null})}rotateStart({pos:e}){let t=this.getAltitude?.(e);return this._getUpdatedState({startRotatePos:e,startRotateLngLat:t!==void 0?this._unproject3D(e,t):void 0,startBearing:this.getViewportProps().bearing,startPitch:this.getViewportProps().pitch})}rotate({pos:e,deltaAngleX:t=0,deltaAngleY:i=0}){let{startRotatePos:o,startRotateLngLat:n,startBearing:s,startPitch:a}=this.getState();if(!o||s===void 0||a===void 0)return this;let l;if(e?l=this._getNewRotation(e,o,a,s):l={bearing:s+t,pitch:a+i},n){let c=this.makeViewport({...this.getViewportProps(),...l}),f="panByPosition3D"in c?"panByPosition3D":"panByPosition";return this._getUpdatedState({...l,...c[f](n,o)})}return this._getUpdatedState(l)}rotateEnd(){return this._getUpdatedState({startRotatePos:null,startRotateLngLat:null,startBearing:null,startPitch:null})}zoomStart({pos:e}){return this._getUpdatedState({startZoomLngLat:this._unproject(e),startZoom:this.getViewportProps().zoom})}zoom({pos:e,startPos:t,scale:i}){let{startZoom:o,startZoomLngLat:n}=this.getState();if(n||(o=this.getViewportProps().zoom,n=this._unproject(t)||this._unproject(e)),!n)return this;let s=this._constrainZoom(o+Math.log2(i)),a=this.makeViewport({...this.getViewportProps(),zoom:s});return this._getUpdatedState({zoom:s,...a.panByPosition(n,e)})}zoomEnd(){return this._getUpdatedState({startZoomLngLat:null,startZoom:null})}zoomIn(e=2){return this._zoomFromCenter(e)}zoomOut(e=2){return this._zoomFromCenter(1/e)}moveLeft(e=100){return this._panFromCenter([e,0])}moveRight(e=100){return this._panFromCenter([-e,0])}moveUp(e=100){return this._panFromCenter([0,e])}moveDown(e=100){return this._panFromCenter([0,-e])}rotateLeft(e=15){return this._getUpdatedState({bearing:this.getViewportProps().bearing-e})}rotateRight(e=15){return this._getUpdatedState({bearing:this.getViewportProps().bearing+e})}rotateUp(e=10){return this._getUpdatedState({pitch:this.getViewportProps().pitch+e})}rotateDown(e=10){return this._getUpdatedState({pitch:this.getViewportProps().pitch-e})}shortestPathFrom(e){let t=e.getViewportProps(),i={...this.getViewportProps()},{bearing:o,longitude:n}=i;return Math.abs(o-t.bearing)>180&&(i.bearing=o<0?o+360:o-360),Math.abs(n-t.longitude)>180&&(i.longitude=n<0?n+360:n-360),i}applyConstraints(e){let{maxPitch:t,minPitch:i,pitch:o,longitude:n,bearing:s,normalize:a,maxBounds:l}=e;if(a&&((n<-180||n>180)&&(e.longitude=oi(n+180,360)-180),(s<-180||s>180)&&(e.bearing=oi(s+180,360)-180)),e.pitch=F(o,i,t),e.zoom=this._constrainZoom(e.zoom,e),l){let c=Ur(l[0]),f=Ur(l[1]),u=2**e.zoom,h=e.width/2/u,p=e.height/2/u,[d,g]=Y([c[0]+h,c[1]+p]),[b,v]=Y([f[0]-h,f[1]-p]);e.longitude=F(e.longitude,d,b),e.latitude=F(e.latitude,g,v)}return e}_constrainZoom(e,t){t||(t=this.getViewportProps());let{maxZoom:i,maxBounds:o}=t,n=o!==null&&t.width>0&&t.height>0,{minZoom:s}=t;if(n){let a=Ur(o[0]),l=Ur(o[1]),c=l[0]-a[0],f=l[1]-a[1];Number.isFinite(c)&&c>0&&(s=Math.max(s,Math.log2(t.width/c))),Number.isFinite(f)&&f>0&&(s=Math.max(s,Math.log2(t.height/f))),s>i&&(s=i)}return F(e,s,i)}_zoomFromCenter(e){let{width:t,height:i}=this.getViewportProps();return this.zoom({pos:[t/2,i/2],scale:e})}_panFromCenter(e){let{width:t,height:i}=this.getViewportProps();return this.pan({startPos:[t/2,i/2],pos:[t/2+e[0],i/2+e[1]]})}_getUpdatedState(e){return new this.constructor({makeViewport:this.makeViewport,...this.getViewportProps(),...this.getState(),...e})}_unproject(e){let t=this.makeViewport(this.getViewportProps());return e&&t.unproject(e)}_unproject3D(e,t){return this.makeViewport(this.getViewportProps()).unproject(e,{targetZ:t})}_getNewRotation(e,t,i,o){let n=e[0]-t[0],s=e[1]-t[1],a=e[1],l=t[1],{width:c,height:f}=this.getViewportProps(),u=n/c,h=0;s>0?Math.abs(f-l)>ja&&(h=s/(l-f)*rh):s<0&&l>ja&&(h=1-a/l),h=F(h,-1,1);let{minPitch:p,maxPitch:d}=this.getViewportProps(),g=o+180*u,b=i;return h>0?b=i+h*(d-i):h<0&&(b=i-h*(p-i)),{pitch:b,bearing:g}}},hi=class extends Ze{constructor(){super(...arguments),this.ControllerState=ui,this.transition={transitionDuration:300,transitionInterpolator:new ye({transitionProps:{compare:["longitude","latitude","zoom","bearing","pitch","position"],required:["longitude","latitude","zoom"]}})},this.dragMode="pan",this.rotationPivot="center",this._getAltitude=e=>{if(this.rotationPivot==="2d")return 0;if(this.rotationPivot==="3d"&&this.pickPosition){let{x:t,y:i}=this.props,o=this.pickPosition(t+e[0],i+e[1]);if(o&&o.coordinate&&o.coordinate.length>=3)return o.coordinate[2]}}}setProps(e){"rotationPivot"in e&&(this.rotationPivot=e.rotationPivot||"center"),e.getAltitude=this._getAltitude,e.position=e.position||[0,0,0],e.maxBounds=e.maxBounds||(e.normalize===!1?null:Ha),super.setProps(e)}updateViewport(e,t=null,i={}){let o=e.getState();i.isDragging&&o.startRotateLngLat?i={...i,rotationPivotPosition:o.startRotateLngLat}:i.isDragging===!1&&(i={...i,rotationPivotPosition:void 0}),super.updateViewport(e,t,i)}};var Dr=class extends Ye{constructor(e={}){super(e)}getViewportType(){return qe}get ControllerType(){return hi}};Dr.displayName="MapView";var un=Dr;var oh=[255,255,255],nh=1,sh=0,kr=class{constructor(e={}){this.type="ambient";let{color:t=oh}=e,{intensity:i=nh}=e;this.id=e.id||`ambient-${sh++}`,this.color=t,this.intensity=i}};var ah=[255,255,255],lh=1,ch=[0,0,-1],fh=0,pi=class{constructor(e={}){this.type="directional";let{color:t=ah}=e,{intensity:i=lh}=e,{direction:o=ch}=e,{_shadow:n=!1}=e;this.id=e.id||`directional-${fh++}`,this.color=t,this.intensity=i,this.type="directional",this.direction=new z(o).normalize().toArray(),this.shadow=n}getProjectedLight(e){return this}};var di=class{constructor(e,t={id:"pass"}){let{id:i}=t;this.id=i,this.device=e,this.props={...t}}setProps(e){Object.assign(this.props,e)}render(e){}cleanup(){}};var uh={depthWriteEnabled:!0,depthCompare:"less-equal",blendColorOperation:"add",blendColorSrcFactor:"src-alpha",blendColorDstFactor:"one",blendAlphaOperation:"add",blendAlphaSrcFactor:"one-minus-dst-alpha",blendAlphaDstFactor:"one"},xe=class extends di{constructor(){super(...arguments),this._lastRenderIndex=-1}render(e){this._render(e)}_render(e){let t=this.device.canvasContext,i=e.target??t.getCurrentFramebuffer(),[o,n]=t.getDrawingBufferSize(),s=e.clearCanvas??!0,a=e.clearColor??(s?[0,0,0,0]:!1),l=s?1:!1,c=s?0:!1,f=e.colorMask??15,u={viewport:[0,0,o,n]};e.colorMask&&(u.colorMask=f),e.scissorRect&&(u.scissorRect=e.scissorRect);let h=this.device.beginRenderPass({framebuffer:i,parameters:u,clearColor:a,clearDepth:l,clearStencil:c});try{return this._drawLayers(h,e)}finally{h.end(),this.device.submit()}}_drawLayers(e,t){let{target:i,shaderModuleProps:o,viewports:n,views:s,onViewportActive:a,clearStack:l=!0}=t;t.pass=t.pass||"unknown",l&&(this._lastRenderIndex=-1);let c=[];for(let f of n){let u=s&&s[f.id];a?.(f);let h=this._getDrawLayerParams(f,t),p=f.subViewports||[f];for(let d of p){let g=this._drawLayersInViewport(e,{target:i,shaderModuleProps:o,viewport:d,view:u,pass:t.pass,layers:t.layers},h);c.push(g)}}return c}_getDrawLayerParams(e,{layers:t,pass:i,isPicking:o=!1,layerFilter:n,cullRect:s,views:a,effects:l,shaderModuleProps:c},f=!1){let u=[],h=$a(this._lastRenderIndex+1),p={layer:t[0],viewport:e,isPicking:o,renderPass:i,cullRect:s},d={};for(let g=0;g<t.length;g++){let b=t[g],v=this._shouldDrawLayer(b,p,n,d),y={shouldDrawLayer:v};if(v&&!f){y.shouldDrawLayer=!0,y.layerRenderIndex=h(b,v),y.shaderModuleProps=this._getShaderModuleProps(b,l,i,c);let _=b.context.device.type==="webgpu"?uh:null;y.layerParameters={..._,...b.context.deck?.props.parameters,...a?.[e.id]?.props.parameters,...this.getLayerParameters(b,g,e)}}u[g]=y}return u}_drawLayersInViewport(e,{layers:t,shaderModuleProps:i,pass:o,target:n,viewport:s,view:a},l){let c=hh(this.device,{shaderModuleProps:i,target:n,viewport:s});if(a){let{clear:u,clearColor:h,clearDepth:p,clearStencil:d}=a.props;if(u){let g=[0,0,0,0],b=1,v=0;Array.isArray(h)?g=[...h.slice(0,3),h[3]||255].map(_=>_/255):h===!1&&(g=!1),p!==void 0&&(b=p),d!==void 0&&(v=d),this.device.beginRenderPass({framebuffer:n,parameters:{viewport:c,scissorRect:c},clearColor:g,clearDepth:b,clearStencil:v}).end()}}let f={totalCount:t.length,visibleCount:0,compositeCount:0,pickableCount:0};e.setParameters({viewport:c});for(let u=0;u<t.length;u++){let h=t[u],p=l[u],{shouldDrawLayer:d}=p;if(d&&h.props.pickable&&f.pickableCount++,h.isComposite&&f.compositeCount++,h.isDrawable&&p.shouldDrawLayer){let{layerRenderIndex:g,shaderModuleProps:b,layerParameters:v}=p;f.visibleCount++,this._lastRenderIndex=Math.max(this._lastRenderIndex,g),b.project&&(b.project.viewport=s),h.context.renderPass=e;try{h._drawLayer({renderPass:e,shaderModuleProps:b,uniforms:{layerIndex:g},parameters:v})}catch(y){h.raiseError(y,`drawing ${h} to ${o}`)}}}return f}shouldDrawLayer(e){return!0}getShaderModuleProps(e,t,i){return null}getLayerParameters(e,t,i){return e.props.parameters}_shouldDrawLayer(e,t,i,o){if(!(e.props.visible&&this.shouldDrawLayer(e)))return!1;t.layer=e;let s=e.parent;for(;s;){if(!s.props.visible||!s.filterSubLayer(t))return!1;t.layer=s,s=s.parent}if(i){let a=t.layer.id;if(a in o||(o[a]=i(t)),!o[a])return!1}return e.activateViewport(t.viewport),!0}_getShaderModuleProps(e,t,i,o){let n=this.device.canvasContext.cssToDeviceRatio(),s=e.internalState?.propsInTransition||e.props,a={layer:s,picking:{isActive:!1},project:{viewport:e.context.viewport,devicePixelRatio:n,modelMatrix:s.modelMatrix,coordinateSystem:s.coordinateSystem,coordinateOrigin:s.coordinateOrigin,autoWrapLongitude:e.wrapLongitude}};if(t)for(let l of t)Wa(a,l.getShaderModuleProps?.(e,a));for(let l of e.context.defaultShaderModules)l.name in a||(a[l.name]={});return Wa(a,this.getShaderModuleProps(e,t,a),o)}};function $a(r=0,e={}){let t={},i=(o,n)=>{let s=o.props._offset,a=o.id,l=o.parent&&o.parent.id,c;if(l&&!(l in e)&&i(o.parent,!1),l in t){let f=t[l]=t[l]||$a(e[l],e);c=f(o,n),t[a]=f}else Number.isFinite(s)?(c=s+(e[l]||0),t[a]=null):c=r;return n&&c>=r&&(r=c+1),e[a]=c,c};return i}function hh(r,{shaderModuleProps:e,target:t,viewport:i}){let o=e?.project?.devicePixelRatio??r.canvasContext.cssToDeviceRatio(),[,n]=r.canvasContext.getDrawingBufferSize(),s=t?t.height:n,a=i;return[a.x*o,s-(a.y+a.height)*o,a.width*o,a.height*o]}function Wa(r,...e){for(let t of e)if(t)for(let i in t)r[i]?Object.assign(r[i],t[i]):r[i]=t[i];return r}var mi=class extends xe{constructor(e,t){super(e,t);let i=e.createTexture({format:"rgba8unorm",width:1,height:1,sampler:{minFilter:"linear",magFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"}}),o=e.createTexture({format:"depth16unorm",width:1,height:1});this.fbo=e.createFramebuffer({id:"shadowmap",width:1,height:1,colorAttachments:[i],depthStencilAttachment:o})}delete(){this.fbo&&(this.fbo.destroy(),this.fbo=null)}getShadowMap(){return this.fbo.colorAttachments[0].texture}render(e){let t=this.fbo,i=this.device.canvasContext.cssToDeviceRatio(),o=e.viewports[0],n=o.width*i,s=o.height*i,a=[1,1,1,1];(n!==t.width||s!==t.height)&&t.resize({width:n,height:s}),super.render({...e,clearColor:a,target:t,pass:"shadow"})}getLayerParameters(e,t,i){return{...e.props.parameters,blend:!1,depthWriteEnabled:!0,depthCompare:"less-equal"}}shouldDrawLayer(e){return e.props.shadowEnabled!==!1}getShaderModuleProps(e,t,i){return{shadow:{project:i.project,drawToShadowMap:!0}}}};var ph={color:[255,255,255],intensity:1},Ya=[{color:[255,255,255],intensity:1,direction:[-1,3,-1]},{color:[255,255,255],intensity:.9,direction:[1,-8,-2.5]}],dh=[0,0,0,200/255],St=class{constructor(e={}){this.id="lighting-effect",this.shadowColor=dh,this.shadow=!1,this.directionalLights=[],this.pointLights=[],this.shadowPasses=[],this.dummyShadowMap=null,this.setProps(e)}setup(e){this.context=e;let{device:t,deck:i}=e;this.shadow&&!this.dummyShadowMap&&(this._createShadowPasses(t),i._addDefaultShaderModule(Pr),this.dummyShadowMap=t.createTexture({width:1,height:1}))}setProps(e){this.ambientLight=void 0,this.directionalLights=[],this.pointLights=[];for(let t in e){let i=e[t];switch(i.type){case"ambient":this.ambientLight=i;break;case"directional":this.directionalLights.push(i);break;case"point":this.pointLights.push(i);break;default:}}this._applyDefaultLights(),this.shadow=this.directionalLights.some(t=>t.shadow),this.context&&this.setup(this.context),this.props=e}preRender({layers:e,layerFilter:t,viewports:i,onViewportActive:o,views:n}){if(this.shadow){this.shadowMatrices=this._calculateMatrices();for(let s=0;s<this.shadowPasses.length;s++)this.shadowPasses[s].render({layers:e,layerFilter:t,viewports:i,onViewportActive:o,views:n,shaderModuleProps:{shadow:{shadowLightId:s,dummyShadowMap:this.dummyShadowMap,shadowMatrices:this.shadowMatrices}}})}}getShaderModuleProps(e,t){let i=this.shadow?{project:t.project,shadowMaps:this.shadowPasses.map(s=>s.getShadowMap()),dummyShadowMap:this.dummyShadowMap,shadowColor:this.shadowColor,shadowMatrices:this.shadowMatrices}:{},o={enabled:!0,lights:this._getLights(e)},n=e.props.material;return{shadow:i,lighting:o,phongMaterial:n,gouraudMaterial:n}}cleanup(e){for(let t of this.shadowPasses)t.delete();this.shadowPasses.length=0,this.dummyShadowMap&&(this.dummyShadowMap.destroy(),this.dummyShadowMap=null,e.deck._removeDefaultShaderModule(Pr))}_calculateMatrices(){let e=[];for(let t of this.directionalLights){let i=new O().lookAt({eye:new z(t.direction).negate()});e.push(i)}return e}_createShadowPasses(e){for(let t=0;t<this.directionalLights.length;t++){let i=new mi(e);this.shadowPasses[t]=i}}_applyDefaultLights(){let{ambientLight:e,pointLights:t,directionalLights:i}=this;!e&&t.length===0&&i.length===0&&(this.ambientLight=new kr(ph),this.directionalLights.push(new pi(Ya[0]),new pi(Ya[1])))}_getLights(e){let t=[];this.ambientLight&&t.push(this.ambientLight);for(let i of this.pointLights)t.push(i.getProjectedLight({layer:e}));for(let i of this.directionalLights)t.push(i.getProjectedLight({layer:e}));return t}};var mh=new St;function gh(r,e){let t=r.order??1/0,i=e.order??1/0;return t-i}var gi=class{constructor(e){this._resolvedEffects=[],this._defaultEffects=[],this.effects=[],this._context=e,this._needsRedraw="Initial render",this._setEffects([])}addDefaultEffect(e){let t=this._defaultEffects;if(!t.find(i=>i.id===e.id)){let i=t.findIndex(o=>gh(o,e)>0);i<0?t.push(e):t.splice(i,0,e),e.setup(this._context),this._setEffects(this.effects)}}setProps(e){"effects"in e&&(B(e.effects,this.effects,1)||this._setEffects(e.effects))}needsRedraw(e={clearRedrawFlags:!1}){let t=this._needsRedraw;return e.clearRedrawFlags&&(this._needsRedraw=!1),t}getEffects(){return this._resolvedEffects}_setEffects(e){let t={};for(let o of this.effects)t[o.id]=o;let i=[];for(let o of e){let n=t[o.id],s=o;n&&n!==o?n.setProps?(n.setProps(o.props),s=n):n.cleanup(this._context):n||o.setup(this._context),i.push(s),delete t[o.id]}for(let o in t)t[o].cleanup(this._context);this.effects=i,this._resolvedEffects=i.concat(this._defaultEffects),e.some(o=>o instanceof St)||this._resolvedEffects.push(mh),this._needsRedraw="effects changed"}finalize(){for(let e of this._resolvedEffects)e.cleanup(this._context);this.effects.length=0,this._resolvedEffects.length=0,this._defaultEffects.length=0}};var _i=class extends xe{shouldDrawLayer(e){let{operation:t}=e.props;return t.includes("draw")||t.includes("terrain")}render(e){return this._render(e)}};var _h={blendColorOperation:"add",blendColorSrcFactor:"one",blendColorDstFactor:"zero",blendAlphaOperation:"add",blendAlphaSrcFactor:"constant",blendAlphaDstFactor:"zero"},Ke=class extends xe{constructor(){super(...arguments),this._colorEncoderState=null}render(e){return"pickingFBO"in e?this._drawPickingBuffer(e):{decodePickingColor:null,stats:super._render(e)}}_drawPickingBuffer({layers:e,layerFilter:t,views:i,viewports:o,onViewportActive:n,pickingFBO:s,deviceRect:{x:a,y:l,width:c,height:f},cullRect:u,effects:h,pass:p="picking",pickZ:d,shaderModuleProps:g,clearColor:b}){this.pickZ=d;let v=this._resetColorEncoder(d),y=[a,l,c,f],_=super._render({target:s,layers:e,layerFilter:t,views:i,viewports:o,onViewportActive:n,cullRect:u,effects:h?.filter(P=>P.useInPicking),pass:p,isPicking:!0,shaderModuleProps:g,clearColor:b??[0,0,0,0],colorMask:15,scissorRect:y});return this._colorEncoderState=null,{decodePickingColor:v&&bh.bind(null,v),stats:_}}shouldDrawLayer(e){let{pickable:t,operation:i}=e.props;return t&&i.includes("draw")||i.includes("terrain")||i.includes("mask")}getShaderModuleProps(e,t,i){return{picking:{isActive:1,isAttribute:this.pickZ},lighting:{enabled:!1}}}getLayerParameters(e,t,i){let o={...e.props.parameters},{pickable:n,operation:s}=e.props;return this._colorEncoderState?n&&s.includes("draw")?(Object.assign(o,_h),o.blend=!0,this.device.type==="webgpu"?o.blendConstant=qa(this._colorEncoderState,e,i):o.blendColor=qa(this._colorEncoderState,e,i),s.includes("terrain")&&e.state?._hasPickingCover&&(o.blendAlphaSrcFactor="one")):s.includes("terrain")&&(o.blend=!1):o.blend=!1,o}_resetColorEncoder(e){return this._colorEncoderState=e?null:{byLayer:new Map,byAlpha:[]},this._colorEncoderState}};function qa(r,e,t){let{byLayer:i,byAlpha:o}=r,n,s=i.get(e);return s?(s.viewports.push(t),n=s.a):(n=i.size+1,n<=255?(s={a:n,layer:e,viewports:[t]},i.set(e,s),o[n]=s):(M.warn("Too many pickable layers, only picking the first 255")(),n=0)),[0,0,0,n/255]}function bh(r,e){let t=r.byAlpha[e[3]];return t&&{pickedLayer:t.layer,pickedViewports:t.viewports,pickedObjectIndex:t.layer.decodePickingColor(e)}}var vh="deckRenderer.renderLayers",bi=class{constructor(e,t={}){this.device=e,this.stats=t.stats,this.layerFilter=null,this.drawPickingColors=!1,this.drawLayersPass=new _i(e),this.pickLayersPass=new Ke(e),this.renderCount=0,this._needsRedraw="Initial render",this.renderBuffers=[],this.lastPostProcessEffect=null}setProps(e){this.layerFilter!==e.layerFilter&&(this.layerFilter=e.layerFilter,this._needsRedraw="layerFilter changed"),this.drawPickingColors!==e.drawPickingColors&&(this.drawPickingColors=e.drawPickingColors,this._needsRedraw="drawPickingColors changed")}renderLayers(e){if(!e.viewports.length)return;let t=this.drawPickingColors?this.pickLayersPass:this.drawLayersPass,i={layerFilter:this.layerFilter,isPicking:this.drawPickingColors,...e};i.effects&&this._preRender(i.effects,i);let o=this.lastPostProcessEffect?this.renderBuffers[0]:i.target;this.lastPostProcessEffect&&(i.clearColor=[0,0,0,0],i.clearCanvas=!0);let n=t.render({...i,target:o}),s="stats"in n?n.stats:n;i.effects&&(this.lastPostProcessEffect&&(i.clearCanvas=e.clearCanvas===void 0?!0:e.clearCanvas),this._postRender(i.effects,i)),this.renderCount++,V(vh,this,s,e),this._updateStats(s)}needsRedraw(e={clearRedrawFlags:!1}){let t=this._needsRedraw;return e.clearRedrawFlags&&(this._needsRedraw=!1),t}finalize(){let{renderBuffers:e}=this;for(let t of e)t.delete();e.length=0}_updateStats(e){if(!this.stats)return;let t=0;for(let{visibleCount:i}of e)t+=i;this.stats.get("Layers rendered").addCount(t)}_preRender(e,t){this.lastPostProcessEffect=null,t.preRenderStats=t.preRenderStats||{};for(let i of e)t.preRenderStats[i.id]=i.preRender(t),i.postRender&&(this.lastPostProcessEffect=i.id);this.lastPostProcessEffect&&this._resizeRenderBuffers()}_resizeRenderBuffers(){let{renderBuffers:e}=this,t=this.device.canvasContext.getDrawingBufferSize(),[i,o]=t;e.length===0&&[0,1].map(n=>{let s=this.device.createTexture({sampler:{minFilter:"linear",magFilter:"linear"},width:i,height:o});e.push(this.device.createFramebuffer({id:`deck-renderbuffer-${n}`,colorAttachments:[s]}))});for(let n of e)n.resize(t)}_postRender(e,t){let{renderBuffers:i}=this,o={...t,inputBuffer:i[0],swapBuffer:i[1]};for(let n of e)if(n.postRender){o.target=n.id===this.lastPostProcessEffect?t.target:void 0;let s=n.postRender(o);o.inputBuffer=s,o.swapBuffer=s===i[0]?i[1]:i[0]}}};var yh={pickedColor:null,pickedObjectIndex:-1};function hn({pickedColors:r,decodePickingColor:e,deviceX:t,deviceY:i,deviceRadius:o,deviceRect:n}){let{x:s,y:a,width:l,height:c}=n,f=o*o,u=-1,h=0;for(let p=0;p<c;p++){let d=p+a-i,g=d*d;if(g>f)h+=4*l;else for(let b=0;b<l;b++){if(r[h+3]-1>=0){let y=b+s-t,_=y*y+g;_<=f&&(f=_,u=h)}h+=4}}if(u>=0){let p=r.slice(u,u+4),d=e(p);if(d){let g=Math.floor(u/4/l),b=u/4-g*l;return{...d,pickedColor:p,pickedX:s+b,pickedY:a+g}}M.error("Picked non-existent layer. Is picking buffer corrupt?")()}return yh}function pn({pickedColors:r,decodePickingColor:e}){let t=new Map;if(r){for(let i=0;i<r.length;i+=4)if(r[i+3]-1>=0){let n=r.slice(i,i+4),s=n.join(",");if(!t.has(s)){let a=e(n);a?t.set(s,{...a,color:n}):M.error("Picked non-existent layer. Is picking buffer corrupt?")()}}}return Array.from(t.values())}function Br({pickInfo:r,viewports:e,pixelRatio:t,x:i,y:o,z:n}){let s=e[0];e.length>1&&(s=Sh(r?.pickedViewports||e,{x:i,y:o}));let a;if(s){let l=[i-s.x,o-s.y];n!==void 0&&(l[2]=n),a=s.unproject(l)}return{color:null,layer:null,viewport:s,index:-1,picked:!1,x:i,y:o,pixel:[i,o],coordinate:a,devicePixel:r&&"pickedX"in r?[r.pickedX,r.pickedY]:void 0,pixelRatio:t}}function dn(r){let{pickInfo:e,lastPickedInfo:t,mode:i,layers:o}=r,{pickedColor:n,pickedLayer:s,pickedObjectIndex:a}=e,l=s?[s]:[];if(i==="hover"){let u=t.index,h=t.layerId,p=s?s.props.id:null;if(p!==h||a!==u){if(p!==h){let d=o.find(g=>g.props.id===h);d&&l.unshift(d)}t.layerId=p,t.index=a,t.info=null}}let c=Br(r),f=new Map;return f.set(null,c),l.forEach(u=>{let h={...c};u===s&&(h.color=n,h.index=a,h.picked=!0),h=Vr({layer:u,info:h,mode:i});let p=h.layer;u===s&&i==="hover"&&(t.info=h),f.set(p.id,h),i==="hover"&&p.updateAutoHighlight(h)}),f}function Vr({layer:r,info:e,mode:t}){for(;r&&e;){let i=e.layer||null;e.sourceLayer=i,e.layer=r,e=r.getPickingInfo({info:e,mode:t,sourceLayer:i}),r=r.parent}return e}function Sh(r,e){for(let t=r.length-1;t>=0;t--){let i=r[t];if(i.containsPixel(e))return i}return r[0]}var vi=class{constructor(e,t={}){this._pickable=!0,this.device=e,this.stats=t.stats,this.pickLayersPass=new Ke(e),this.lastPickedInfo={index:-1,layerId:null,info:null}}setProps(e){"layerFilter"in e&&(this.layerFilter=e.layerFilter),"_pickable"in e&&(this._pickable=e._pickable)}finalize(){this.pickingFBO&&this.pickingFBO.destroy(),this.depthFBO&&this.depthFBO.destroy()}pickObjectAsync(e){return this._pickClosestObjectAsync(e)}pickObjectsAsync(e){return this._pickVisibleObjectsAsync(e)}pickObject(e){return this._pickClosestObject(e)}pickObjects(e){return this._pickVisibleObjects(e)}getLastPickedObject({x:e,y:t,layers:i,viewports:o},n=this.lastPickedInfo.info){let s=n&&n.layer&&n.layer.id,a=n&&n.viewport&&n.viewport.id,l=s?i.find(h=>h.id===s):null,c=a&&o.find(h=>h.id===a)||o[0],f=c&&c.unproject([e-c.x,t-c.y]);return{...n,...{x:e,y:t,viewport:c,coordinate:f,layer:l}}}_resizeBuffer(e=this.device.getDefaultCanvasContext()){if(!this.pickingFBO){let o=this.device.createTexture({format:"rgba8unorm",width:1,height:1,usage:k.RENDER_ATTACHMENT|k.COPY_SRC});if(this.pickingFBO=this.device.createFramebuffer({colorAttachments:[o],depthStencilAttachment:"depth16unorm"}),this.device.isTextureFormatRenderable("rgba32float")){let n=this.device.createTexture({format:"rgba32float",width:1,height:1,usage:k.RENDER_ATTACHMENT|k.COPY_SRC}),s=this.device.createFramebuffer({colorAttachments:[n],depthStencilAttachment:"depth16unorm"});this.depthFBO=s}}let[t,i]=e.getDrawingBufferSize();this.pickingFBO?.resize({width:t,height:i}),this.depthFBO?.resize({width:t,height:i})}_getPickable(e){if(this._pickable===!1)return null;let t=e.filter(i=>this.pickLayersPass.shouldDrawLayer(i)&&!i.isComposite);return t.length?t:null}async _pickClosestObjectAsync({layers:e,views:t,viewports:i,x:o,y:n,radius:s=0,depth:a=1,mode:l="query",unproject3D:c,canvasContext:f=this.device.getDefaultCanvasContext(),onViewportActive:u,effects:h}){let p=f.cssToDeviceRatio(),d=this._getPickable(e);if(!d||i.length===0)return{result:[],emptyInfo:Br({viewports:i,x:o,y:n,pixelRatio:p})};this._resizeBuffer(f);let g=f.cssToDevicePixels([o,n],!0),b=[g.x+Math.floor(g.width/2),g.y+Math.floor(g.height/2)],v=Math.round(s*p),{width:y,height:_}=this.pickingFBO,S=this._getPickingRect({deviceX:b[0],deviceY:b[1],deviceRadius:v,deviceWidth:y,deviceHeight:_}),P={x:o-s,y:n-s,width:s*2+1,height:s*2+1},x,E=[],C=new Set;for(let T=0;T<a;T++){let A;if(S){let I=await this._drawAndSampleAsync({layers:d,views:t,viewports:i,onViewportActive:u,deviceRect:S,cullRect:P,effects:h,pass:`picking:${l}`});A=hn({...I,deviceX:b[0],deviceY:b[1],deviceRadius:v,deviceRect:S})}else A={pickedColor:null,pickedObjectIndex:-1};let W,G=this._getDepthLayers(A,d,c);if(G.length>0){let{pickedColors:I}=await this._drawAndSampleAsync({layers:G,views:t,viewports:i,onViewportActive:u,deviceRect:{x:A.pickedX??b[0],y:A.pickedY??b[1],width:1,height:1},cullRect:P,effects:h,pass:`picking:${l}:z`},!0);I[3]&&(W=I[0])}A.pickedLayer&&T+1<a&&(C.add(A.pickedLayer),A.pickedLayer.disablePickingIndex(A.pickedObjectIndex)),x=dn({pickInfo:A,lastPickedInfo:this.lastPickedInfo,mode:l,layers:d,viewports:i,x:o,y:n,z:W,pixelRatio:p});for(let I of x.values())I.layer&&E.push(I);if(!A.pickedColor)break}for(let T of C)T.restorePickingColors();return{result:E,emptyInfo:x.get(null)}}_pickClosestObject({layers:e,views:t,viewports:i,x:o,y:n,radius:s=0,depth:a=1,mode:l="query",unproject3D:c,canvasContext:f=this.device.getDefaultCanvasContext(),onViewportActive:u,effects:h}){let p=f.cssToDeviceRatio(),d=this._getPickable(e);if(!d||i.length===0)return{result:[],emptyInfo:Br({viewports:i,x:o,y:n,pixelRatio:p})};this._resizeBuffer(f);let g=f.cssToDevicePixels([o,n],!0),b=[g.x+Math.floor(g.width/2),g.y+Math.floor(g.height/2)],v=Math.round(s*p),{width:y,height:_}=this.pickingFBO,S=this._getPickingRect({deviceX:b[0],deviceY:b[1],deviceRadius:v,deviceWidth:y,deviceHeight:_}),P={x:o-s,y:n-s,width:s*2+1,height:s*2+1},x,E=[],C=new Set;for(let T=0;T<a;T++){let A;if(S){let I=this._drawAndSample({layers:d,views:t,viewports:i,onViewportActive:u,deviceRect:S,cullRect:P,effects:h,pass:`picking:${l}`});A=hn({...I,deviceX:b[0],deviceY:b[1],deviceRadius:v,deviceRect:S})}else A={pickedColor:null,pickedObjectIndex:-1};let W,G=this._getDepthLayers(A,d,c);if(G.length>0){let{pickedColors:I}=this._drawAndSample({layers:G,views:t,viewports:i,onViewportActive:u,deviceRect:{x:A.pickedX??b[0],y:A.pickedY??b[1],width:1,height:1},cullRect:P,effects:h,pass:`picking:${l}:z`},!0);I[3]&&(W=I[0])}A.pickedLayer&&T+1<a&&(C.add(A.pickedLayer),A.pickedLayer.disablePickingIndex(A.pickedObjectIndex)),x=dn({pickInfo:A,lastPickedInfo:this.lastPickedInfo,mode:l,layers:d,viewports:i,x:o,y:n,z:W,pixelRatio:p});for(let I of x.values())I.layer&&E.push(I);if(!A.pickedColor)break}for(let T of C)T.restorePickingColors();return{result:E,emptyInfo:x.get(null)}}async _pickVisibleObjectsAsync({layers:e,views:t,viewports:i,x:o,y:n,width:s=1,height:a=1,mode:l="query",maxObjects:c=null,canvasContext:f=this.device.getDefaultCanvasContext(),onViewportActive:u,effects:h}){let p=this._getPickable(e);if(!p||i.length===0)return[];this._resizeBuffer(f);let d=f.cssToDeviceRatio(),g=f.cssToDevicePixels([o,n],!0),b=g.x,v=g.y+g.height,y=f.cssToDevicePixels([o+s,n+a],!0),_=y.x+y.width,S=y.y,P={x:b,y:S,width:_-b,height:v-S},x=await this._drawAndSampleAsync({layers:p,views:t,viewports:i,onViewportActive:u,deviceRect:P,cullRect:{x:o,y:n,width:s,height:a},effects:h,pass:`picking:${l}`}),E=pn(x),C=new Map,T=[],A=Number.isFinite(c);for(let W=0;W<E.length&&!(A&&T.length>=c);W++){let G=E[W],I={color:G.pickedColor,layer:null,index:G.pickedObjectIndex,picked:!0,x:o,y:n,pixelRatio:d};I=Vr({layer:G.pickedLayer,info:I,mode:l});let Oe=I.layer.id;C.has(Oe)||C.set(Oe,new Set);let Et=C.get(Oe),Mt=I.object??I.index;Et.has(Mt)||(Et.add(Mt),T.push(I))}return T}_pickVisibleObjects({layers:e,views:t,viewports:i,x:o,y:n,width:s=1,height:a=1,mode:l="query",maxObjects:c=null,canvasContext:f=this.device.getDefaultCanvasContext(),onViewportActive:u,effects:h}){let p=this._getPickable(e);if(!p||i.length===0)return[];this._resizeBuffer(f);let d=f.cssToDeviceRatio(),g=f.cssToDevicePixels([o,n],!0),b=g.x,v=g.y+g.height,y=f.cssToDevicePixels([o+s,n+a],!0),_=y.x+y.width,S=y.y,P={x:b,y:S,width:_-b,height:v-S},x=this._drawAndSample({layers:p,views:t,viewports:i,onViewportActive:u,deviceRect:P,cullRect:{x:o,y:n,width:s,height:a},effects:h,pass:`picking:${l}`}),E=pn(x),C=new Map,T=[],A=Number.isFinite(c);for(let W=0;W<E.length&&!(A&&T.length>=c);W++){let G=E[W],I={color:G.pickedColor,layer:null,index:G.pickedObjectIndex,picked:!0,x:o,y:n,pixelRatio:d};I=Vr({layer:G.pickedLayer,info:I,mode:l});let Oe=I.layer.id;C.has(Oe)||C.set(Oe,new Set);let Et=C.get(Oe),Mt=I.object??I.index;Et.has(Mt)||(Et.add(Mt),T.push(I))}return T}async _drawAndSampleAsync({layers:e,views:t,viewports:i,onViewportActive:o,deviceRect:n,cullRect:s,effects:a,pass:l},c=!1){let f=c?this.depthFBO:this.pickingFBO,u={layers:e,layerFilter:this.layerFilter,views:t,viewports:i,onViewportActive:o,pickingFBO:f,deviceRect:n,cullRect:s,effects:a,pass:l,pickZ:c,preRenderStats:{},isPicking:!0};for(let S of a)S.useInPicking&&(u.preRenderStats[S.id]=S.preRender(u));let{decodePickingColor:h,stats:p}=this.pickLayersPass.render(u);this._updateStats(p);let{x:d,y:g,width:b,height:v}=n,y=f.colorAttachments[0]?.texture;if(!y)throw new Error("Picking framebuffer color attachment is missing");let _=await this._readTextureDataAsync(y,{x:d,y:g,width:b,height:v},c?Float32Array:Uint8Array);if(!c){let S=!1;for(let P=3;P<_.length;P+=4)if(_[P]!==0){S=!0;break}!S&&_.length>0&&M.warn("Async pick readback returned only zero alpha values",{deviceRect:n,bytes:Array.from(_.subarray(0,Math.min(_.length,16)))})()}return{pickedColors:_,decodePickingColor:h}}async _readTextureDataAsync(e,t,i){let{width:o,height:n}=t,s=e.computeMemoryLayout(t),a=this.device.createBuffer({byteLength:s.byteLength,usage:U.COPY_DST|U.MAP_READ});try{e.readBuffer(t,a);let l=await a.readAsync(0,s.byteLength),c=i.BYTES_PER_ELEMENT;if(s.bytesPerRow%c!==0)throw new Error(`Texture readback row stride ${s.bytesPerRow} is not aligned to ${c}-byte elements.`);let f=new i(l.buffer,l.byteOffset,s.byteLength/c),u=o*4,h=s.bytesPerRow/c;if(h<u)throw new Error(`Texture readback row stride ${h} is smaller than packed row length ${u}.`);let p=new i(o*n*4);for(let d=0;d<n;d++){let g=d*h;p.set(f.subarray(g,g+u),d*u)}return p}finally{a.destroy()}}_drawAndSample({layers:e,views:t,viewports:i,onViewportActive:o,deviceRect:n,cullRect:s,effects:a,pass:l},c=!1){let f=c?this.depthFBO:this.pickingFBO,u={layers:e,layerFilter:this.layerFilter,views:t,viewports:i,onViewportActive:o,pickingFBO:f,deviceRect:n,cullRect:s,effects:a,pass:l,pickZ:c,preRenderStats:{},isPicking:!0};for(let _ of a)_.useInPicking&&(u.preRenderStats[_.id]=_.preRender(u));let{decodePickingColor:h,stats:p}=this.pickLayersPass.render(u);this._updateStats(p);let{x:d,y:g,width:b,height:v}=n,y=new(c?Float32Array:Uint8Array)(b*v*4);return this.device.readPixelsToArrayWebGL(f,{sourceX:d,sourceY:g,sourceWidth:b,sourceHeight:v,target:y}),{pickedColors:y,decodePickingColor:h}}_updateStats(e){if(!this.stats)return;let t=0;for(let{visibleCount:i}of e)t+=i;this.stats.get("Layers picked").addCount(t)}_getDepthLayers(e,t,i){if(!i||!this.depthFBO)return[];let{pickedLayer:o}=e,n=o?.state?.terrainDrawMode==="drape";return o&&!n?[o]:t.filter(s=>s.props.operation.includes("terrain"))}_getPickingRect({deviceX:e,deviceY:t,deviceRadius:i,deviceWidth:o,deviceHeight:n}){let s=Math.max(0,e-i),a=Math.max(0,t-i),l=Math.min(o,e+i+1)-s,c=Math.min(n,t+i+1)-a;return l<=0||c<=0?null:{x:s,y:a,width:l,height:c}}};var xh={"top-left":{top:0,left:0},"top-right":{top:0,right:0},"bottom-left":{bottom:0,left:0},"bottom-right":{bottom:0,right:0},fill:{top:0,left:0,bottom:0,right:0}},wh="top-left",Xa="root",Fr=class{constructor({deck:e,parentElement:t}){this.defaultWidgets=[],this.widgets=[],this.resolvedWidgets=[],this.containers={},this.lastViewports={},this.deck=e,t?.classList.add("deck-widget-container"),this.parentElement=t}getWidgets(){return this.resolvedWidgets}setProps(e){if(e.widgets&&!B(e.widgets,this.widgets,1)){let t=e.widgets.filter(Boolean);this._setWidgets(t)}}finalize(){for(let e of this.getWidgets())this._removeWidget(e);this.defaultWidgets.length=0,this.resolvedWidgets.length=0;for(let e in this.containers)this.containers[e].remove()}addDefault(e){this.defaultWidgets.find(t=>t.id===e.id)||(this._addWidget(e),this.defaultWidgets.push(e),this._setWidgets(this.widgets))}onRedraw({viewports:e,layers:t}){let i=e.reduce((o,n)=>(o[n.id]=n,o),{});for(let o of this.getWidgets()){let{viewId:n}=o;if(n){let s=i[n];s&&(o.onViewportChange&&o.onViewportChange(s),o.onRedraw?.({viewports:[s],layers:t}))}else{if(o.onViewportChange)for(let s of e)o.onViewportChange(s);o.onRedraw?.({viewports:e,layers:t})}}this.lastViewports=i,this._updateContainers()}onHover(e,t){for(let i of this.getWidgets()){let{viewId:o}=i;(!o||o===e.viewport?.id)&&i.onHover?.(e,t)}}onEvent(e,t){let i=ot[t.type];if(i)for(let o of this.getWidgets()){let{viewId:n}=o;(!n||n===e.viewport?.id)&&o[i]?.(e,t)}}_setWidgets(e){let t={};for(let i of this.resolvedWidgets)t[i.id]=i;this.resolvedWidgets.length=0;for(let i of this.defaultWidgets)t[i.id]=null,this.resolvedWidgets.push(i);for(let i of e){let o=t[i.id];o?o.viewId!==i.viewId||o.placement!==i.placement?(this._removeWidget(o),this._addWidget(i)):i!==o&&(o.setProps(i.props),i=o):this._addWidget(i),t[i.id]=null,this.resolvedWidgets.push(i)}for(let i in t){let o=t[i];o&&this._removeWidget(o)}this.widgets=e}_addWidget(e){let{viewId:t=null,placement:i=wh}=e,o=e.props._container??t;e.widgetManager=this,e.deck=this.deck,e.rootElement=e._onAdd({deck:this.deck,viewId:t}),e.rootElement&&this._getContainer(o,i).append(e.rootElement),e.updateHTML()}_removeWidget(e){e.onRemove?.(),e.rootElement&&e.rootElement.remove(),e.rootElement=void 0,e.deck=void 0,e.widgetManager=void 0}_getContainer(e,t){if(e&&typeof e!="string")return e;let i=e||Xa,o=this.containers[i];o||(o=document.createElement("div"),o.style.pointerEvents="none",o.style.position="absolute",o.style.overflow="hidden",this.parentElement?.append(o),this.containers[i]=o);let n=o.querySelector(`.${t}`);return n||(n=globalThis.document.createElement("div"),n.className=t,n.style.position="absolute",n.style.zIndex="2",Object.assign(n.style,xh[t]),o.append(n)),n}_updateContainers(){let e=this.deck.width,t=this.deck.height;for(let i in this.containers){let o=this.lastViewports[i]||null,n=i===Xa||o,s=this.containers[i];n?(s.style.display="block",s.style.left=`${o?o.x:0}px`,s.style.top=`${o?o.y:0}px`,s.style.width=`${o?o.width:e}px`,s.style.height=`${o?o.height:t}px`):s.style.display="none"}}};function mn(r,e){e&&Object.entries(e).map(([t,i])=>{t.startsWith("--")?r.style.setProperty(t,i):r.style[t]=i})}function Za(r,e){e&&Object.keys(e).map(t=>{t.startsWith("--")?r.style.removeProperty(t):r.style[t]=""})}var xt=class{constructor(e){this.viewId=null,this.props={...this.constructor.defaultProps,...e},this.id=this.props.id}setProps(e){let t=this.props,i=this.rootElement;i&&t.className!==e.className&&(t.className&&i.classList.remove(t.className),e.className&&i.classList.add(e.className)),i&&!B(t.style,e.style,1)&&(Za(i,t.style),mn(i,e.style)),Object.assign(this.props,e),this.updateHTML()}updateHTML(){this.rootElement&&this.onRenderHTML(this.rootElement)}get viewIds(){return this.viewId?[this.viewId]:this.deck?.getViews().map(e=>e.id)??[]}getViewState(e){return this.deck?.viewManager?.getViewState(e)||{}}setViewState(e,t){this.deck?._onViewStateChange({viewId:e,viewState:t,interactionState:{}})}onCreateRootElement(){let e=["deck-widget",this.className,this.props.className],t=document.createElement("div");return e.filter(i=>typeof i=="string"&&i.length>0).forEach(i=>t.classList.add(i)),mn(t,this.props.style),t}_onAdd(e){return this.onAdd(e)??this.onCreateRootElement()}onAdd(e){}onRemove(){}onViewportChange(e){}onRedraw(e){}onHover(e,t){}onClick(e,t){}onDrag(e,t){}onDragStart(e,t){}onDragEnd(e,t){}};xt.defaultProps={id:"widget",style:{},_container:null,className:""};var Eh={zIndex:"1",position:"absolute",pointerEvents:"none",color:"#a0a7b4",backgroundColor:"#29323c",padding:"10px",top:"0",left:"0",display:"none"},yi=class extends xt{constructor(e={}){super(e),this.id="default-tooltip",this.placement="fill",this.className="deck-tooltip",this.isVisible=!1,this.setProps(e)}onCreateRootElement(){let e=document.createElement("div");return e.className=this.className,Object.assign(e.style,Eh),e}onRenderHTML(e){}onViewportChange(e){this.isVisible&&e.id===this.lastViewport?.id&&!e.equals(this.lastViewport)&&this.setTooltip(null),this.lastViewport=e}onHover(e){let{deck:t}=this,i=t&&t.props.getTooltip;if(!i)return;let o=i(e);this.setTooltip(o,e.x,e.y)}setTooltip(e,t,i){let o=this.rootElement;if(o){if(typeof e=="string")o.innerText=e;else if(e)e.text&&(o.innerText=e.text),e.html&&(o.innerHTML=e.html),e.className&&(o.className=e.className);else{this.isVisible=!1,o.style.display="none";return}this.isVisible=!0,o.style.display="block",o.style.transform=`translate(${t}px, ${i}px)`,e&&typeof e=="object"&&"style"in e&&Object.assign(o.style,e.style)}}};yi.defaultProps={...xt.defaultProps};function Mh(r){let e=r[0],t=r[r.length-1];return e==="{"&&t==="}"||e==="["&&t==="]"}var Ka={dataType:null,batchType:null,id:"JSON",name:"JSON",module:"",version:"",options:{},extensions:["json","geojson"],mimeTypes:["application/json","application/geo+json"],testText:Mh,parseTextSync:JSON.parse};function Ph(){let r="9.3.6",e=globalThis.deck&&globalThis.deck.VERSION;if(e&&e!==r)throw new Error(`deck.gl - multiple versions detected: ${e} vs ${r}`);return e||(M.log(1,`deck.gl ${r}`)(),globalThis.deck={...globalThis.deck,VERSION:r,version:r,log:M,_registerLoggers:Ra},Cn([Ka,[Ln,{imagebitmap:{premultiplyAlpha:"none"}}]])),r}var Ja=Ph();function we(){}var Th=({isDragging:r})=>r?"grabbing":"grab",Qa={id:"",width:"100%",height:"100%",style:null,viewState:null,initialViewState:null,pickingRadius:0,pickAsync:"auto",layerFilter:null,parameters:{},parent:null,device:null,deviceProps:{},gl:null,canvas:null,layers:[],effects:[],views:null,controller:null,useDevicePixels:!0,touchAction:"none",eventRecognizerOptions:{},_framebuffer:null,_animate:!1,_pickable:!0,_typedArrayManagerProps:{},_customRender:null,widgets:[],onDeviceInitialized:we,onWebGLInitialized:we,onResize:we,onViewStateChange:we,onInteractionStateChange:we,onBeforeRender:we,onAfterRender:we,onLoad:we,onError:r=>M.error(r.message,r.cause)(),onHover:null,onClick:null,onDragStart:null,onDrag:null,onDragEnd:null,_onMetrics:null,getCursor:Th,getTooltip:null,debug:!1,drawPickingColors:!1},Si=class{constructor(e){this.width=0,this.height=0,this.userData={},this.device=null,this.canvas=null,this.viewManager=null,this.layerManager=null,this.effectManager=null,this.deckRenderer=null,this.deckPicker=null,this.eventManager=null,this.widgetManager=null,this.tooltip=null,this.animationLoop=null,this._canvasContext=null,this._deviceResizeHandler=null,this.cursorState={isHovering:!1,isDragging:!1},this.stats=new Qe({id:"deck.gl"}),this.metrics={fps:0,setPropsTime:0,layersCount:0,drawLayersCount:0,updateLayersCount:0,updateAttributesCount:0,updateAttributesTime:0,framesRedrawn:0,pickTime:0,pickCount:0,pickLayersCount:0,gpuTime:0,gpuTimePerFrame:0,cpuTime:0,cpuTimePerFrame:0,bufferMemory:0,textureMemory:0,renderbufferMemory:0,gpuMemory:0},this._metricsCounter=0,this._hoverPickSequence=0,this._pointerDownPickSequence=0,this._needsRedraw="Initial render",this._pickRequest={mode:"hover",x:-1,y:-1,radius:0,event:null,unproject3D:!1},this._lastPointerDownInfo=null,this._lastPointerDownInfoPromise=null,this._onPointerMove=o=>{let{_pickRequest:n}=this;if(o.type==="pointerleave")n.x=-1,n.y=-1,n.radius=0;else{if(o.leftButton||o.rightButton)return;{let s=o.offsetCenter;if(!s)return;n.x=s.x,n.y=s.y,n.radius=this.props.pickingRadius}}this.layerManager&&(this.layerManager.context.mousePosition={x:n.x,y:n.y}),n.event=o},this._onEvent=o=>{let n=ot[o.type],s=o.offsetCenter;if(!n||!s||!this.layerManager)return;let a=this.layerManager.getLayers(),l=this._getInternalPickingMode();if(!l)return;if(l==="sync"){let f=o.type==="click"&&this._shouldUnproject3D(a)?this._getFirstPickedInfo(this._pickPointSync(this._getPointPickOptions(s.x,s.y,{unproject3D:!0},a))):this._getLastPointerDownPickingInfo(s.x,s.y,a);this._dispatchPickingEvent(f,o);return}(this._lastPointerDownInfoPromise||Promise.resolve(this._getLastPointerDownPickingInfo(s.x,s.y,a))).then(f=>{this._dispatchPickingEvent(f,o)}).catch(f=>this.props.onError?.(f))},this._onPointerDown=o=>{let n=o.offsetCenter;if(!n)return;let s=this._getInternalPickingMode();if(!s)return;let a=this.layerManager?.getLayers()||[],l=++this._pointerDownPickSequence;if(s==="sync"){let f=this._pickPointSync({x:n.x,y:n.y,radius:this.props.pickingRadius}),u=this._getFirstPickedInfo(f);this._lastPointerDownInfo=u,this._lastPointerDownInfoPromise=Promise.resolve(u);return}let c=this._pickPointAsync(this._getPointPickOptions(n.x,n.y,{},a)).then(f=>this._getFirstPickedInfo(f)).then(f=>(l===this._pointerDownPickSequence&&(this._lastPointerDownInfo=f),f)).catch(f=>{this.props.onError?.(f);let u=this.deckPicker&&this.viewManager?this._getLastPointerDownPickingInfo(n.x,n.y,a):{};return l===this._pointerDownPickSequence&&(this._lastPointerDownInfo=u),u});this._lastPointerDownInfo=null,this._lastPointerDownInfoPromise=c};let t=e;this.props={...Qa,...e},e=this.props,e.viewState&&e.initialViewState&&M.warn("View state tracking is disabled. Use either `initialViewState` for auto update or `viewState` for manual update.")(),this.viewState=this.props.initialViewState,e.device&&(this.device=e.device,this._setDeviceCanvasContext(e.device));let i=this.device;!i&&e.gl&&(e.gl instanceof WebGLRenderingContext&&M.error("WebGL1 context not supported.")(),i=Gi.attach(e.gl,{_cacheShaders:!0,_cachePipelines:!0,...this.props.deviceProps})),i||(i=this._createDevice(e)),this.animationLoop=this._createAnimationLoop(i,e),this.setProps(t),e._typedArrayManagerProps&&se.setOptions(e._typedArrayManagerProps),this.animationLoop.start()}finalize(){this._restoreDeviceResizeHandler(),this.animationLoop?.stop(),this.animationLoop?.destroy(),this.animationLoop=null,this._hoverPickSequence++,this._pointerDownPickSequence++,this._lastPointerDownInfo=null,this._lastPointerDownInfoPromise=null,this.layerManager?.finalize(),this.layerManager=null,this.viewManager?.finalize(),this.viewManager=null,this.effectManager?.finalize(),this.effectManager=null,this.deckRenderer?.finalize(),this.deckRenderer=null,this.deckPicker?.finalize(),this.deckPicker=null,this.eventManager?.destroy(),this.eventManager=null,this.widgetManager?.finalize(),this.widgetManager=null,!this.props.canvas&&!this.props.device&&!this.props.gl&&this.canvas&&(this.canvas.parentElement?.removeChild(this.canvas),this.canvas=null),this._canvasContext=null}setProps(e){this.stats.get("setProps Time").timeStart(),"onLayerHover"in e&&M.removed("onLayerHover","onHover")(),"onLayerClick"in e&&M.removed("onLayerClick","onClick")(),e.initialViewState&&!B(this.props.initialViewState,e.initialViewState,3)&&(this.viewState=e.initialViewState),Object.assign(this.props,e),this._validateInternalPickingMode(),this._setCanvasSize(this.props);let t=Object.create(this.props);if(Object.assign(t,{views:this._getViews(),width:this.width,height:this.height,viewState:this._getViewState()}),e.device&&e.device.id!==this.device?.id){let i=e.device.getDefaultCanvasContext();this.animationLoop?.stop(),this.canvas!==i.canvas&&(this.canvas?.remove(),this.eventManager?.destroy(),this.canvas=null),this._setDeviceCanvasContext(e.device),M.log(`recreating animation loop for new device! id=${e.device.id}`)(),this.animationLoop=this._createAnimationLoop(e.device,e),this.animationLoop.start()}this.animationLoop?.setProps(t),e.useDevicePixels!==void 0&&this._canvasContext?.setProps&&this._canvasContext.setProps({useDevicePixels:e.useDevicePixels}),this.layerManager&&(this.viewManager.setProps(t),this.layerManager.activateViewport(this.getViewports()[0]),this.layerManager.setProps(t),this.effectManager.setProps(t),this.deckRenderer.setProps(t),this.deckPicker.setProps(t),this.widgetManager.setProps(t)),this.stats.get("setProps Time").timeEnd()}needsRedraw(e={clearRedrawFlags:!1}){if(!this.layerManager)return!1;if(this.props._animate)return"Deck._animate";let t=this._needsRedraw;e.clearRedrawFlags&&(this._needsRedraw=!1);let i=this.viewManager.needsRedraw(e),o=this.layerManager.needsRedraw(e),n=this.effectManager.needsRedraw(e),s=this.deckRenderer.needsRedraw(e);return t=t||i||o||n||s,t}redraw(e){if(!this.layerManager)return;let t=this.needsRedraw({clearRedrawFlags:!0});t=e||t,t&&(this.stats.get("Redraw Count").incrementCount(),this.props._customRender?this.props._customRender(t):this._drawLayers(t))}get isInitialized(){return this.viewManager!==null}getViews(){return N(this.viewManager),this.viewManager.views}getView(e){return N(this.viewManager),this.viewManager.getView(e)}getViewports(e){return N(this.viewManager),this.viewManager.getViewports(e)}getCanvas(){return this.canvas}async pickObjectAsync(e){let t=(await this._pickAsync("pickObjectAsync","pickObject Time",e)).result;return t.length?t[0]:null}async pickObjectsAsync(e){return await this._pickAsync("pickObjectsAsync","pickObjects Time",e)}pickObject(e){let t=this._pick("pickObject","pickObject Time",e).result;return t.length?t[0]:null}pickMultipleObjects(e){return e.depth=e.depth||10,this._pick("pickObject","pickMultipleObjects Time",e).result}pickObjects(e){return this._pick("pickObjects","pickObjects Time",e)}_pickPositionForController(e,t){return this._getInternalPickingMode()!=="sync"?null:this.pickObject({x:e,y:t,radius:0,unproject3D:!0})}_addResources(e,t=!1){for(let i in e)this.layerManager.resourceManager.add({resourceId:i,data:e[i],forceUpdate:t})}_removeResources(e){for(let t of e)this.layerManager.resourceManager.remove(t)}_addDefaultEffect(e){this.effectManager.addDefaultEffect(e)}_addDefaultShaderModule(e){this.layerManager.addDefaultShaderModule(e)}_removeDefaultShaderModule(e){this.layerManager?.removeDefaultShaderModule(e)}_resolveInternalPickingMode(){let{pickAsync:e}=this.props,t=this.device?.type||this.props.deviceProps?.type;if(e==="auto")return t==="webgpu"?"async":"sync";if(e==="sync"&&t==="webgpu")throw new Error('`pickAsync: "sync"` is not supported when Deck is using a WebGPU device.');return e}_getInternalPickingMode(){try{return this._resolveInternalPickingMode()}catch(e){return this.props.onError?.(e),null}}_validateInternalPickingMode(){this._getInternalPickingMode()}_getFirstPickedInfo({result:e,emptyInfo:t}){return e[0]||t}_shouldUnproject3D(e=this.layerManager?.getLayers()||[]){return e.some(t=>t.props.pickable==="3d")}_getPointPickOptions(e,t,i={},o=this.layerManager?.getLayers()||[]){return{x:e,y:t,radius:this.props.pickingRadius,unproject3D:this._shouldUnproject3D(o),...i}}_pickPointSync(e){return this._pick("pickObject","pickObject Time",e)}_pickPointAsync(e){return this._pickAsync("pickObjectAsync","pickObject Time",e)}_getLastPointerDownPickingInfo(e,t,i=this.layerManager?.getLayers()||[]){return this.deckPicker.getLastPickedObject({x:e,y:t,layers:i,viewports:this.getViewports({x:e,y:t})},this._lastPointerDownInfo)}_applyHoverCallbacks({result:e,emptyInfo:t},i){if(!this.widgetManager)return;this.cursorState.isHovering=e.length>0;let o=t,n=!1;for(let s of e)o=s,n=s.layer?.onHover(s,i)||n;n||(this.props.onHover?.(o,i),this.widgetManager.onHover(o,i))}_dispatchPickingEvent(e,t){if(!this.layerManager||!this.widgetManager)return;let i=ot[t.type];if(!i)return;let{layer:o}=e,n=o&&(o[i]||o.props[i]),s=this.props[i],a=!1;n&&(a=n.call(o,e,t)),a||(s?.(e,t),this.widgetManager.onEvent(e,t))}_pickAsync(e,t,i){N(this.deckPicker);let{stats:o}=this;o.get("Pick Count").incrementCount(),o.get(t).timeStart();let n=this.deckPicker[e]({layers:this.layerManager.getLayers(i),views:this.viewManager.getViews(),viewports:this.getViewports(i),onViewportActive:this.layerManager.activateViewport,effects:this.effectManager.getEffects(),...i,canvasContext:this._canvasContext||void 0});return o.get(t).timeEnd(),n}_pick(e,t,i){N(this.deckPicker);let{stats:o}=this;o.get("Pick Count").incrementCount(),o.get(t).timeStart();let n=this.deckPicker[e]({layers:this.layerManager.getLayers(i),views:this.viewManager.getViews(),viewports:this.getViewports(i),onViewportActive:this.layerManager.activateViewport,effects:this.effectManager.getEffects(),...i,canvasContext:this._canvasContext||void 0});return o.get(t).timeEnd(),n}_createCanvas(e){let t=e.canvas;return typeof t=="string"&&(t=document.getElementById(t),N(t)),t||(t=document.createElement("canvas"),t.id=e.id||"deckgl-overlay",e.width&&typeof e.width=="number"&&(t.width=e.width),e.height&&typeof e.height=="number"&&(t.height=e.height),(e.parent||document.body).appendChild(t)),Object.assign(t.style,e.style),t}_setCanvasContext(e){this._canvasContext=e,"style"in e.canvas&&(this.canvas=e.canvas)}_setDeviceCanvasContext(e,t={}){let i=e.getDefaultCanvasContext();this._setCanvasContext(i),this._setDeviceResizeHandler(e,t)}_setDeviceResizeHandler(e,t={}){let i=!!t.syncDrawingBuffer;if(this._deviceResizeHandler?.device===e){this._deviceResizeHandler.syncDrawingBuffer=i;return}this._restoreDeviceResizeHandler();let o=n=>{n===this._canvasContext&&this._canvasContext&&this._onCanvasContextResize(this._canvasContext,{syncDrawingBuffer:this._deviceResizeHandler?.syncDrawingBuffer})};e.props.onResize=o,this._deviceResizeHandler={device:e,onResize:o,syncDrawingBuffer:i}}_restoreDeviceResizeHandler(){let e=this._deviceResizeHandler;e&&e.device.props?.onResize===e.onResize&&(e.device.props.onResize=we),this._deviceResizeHandler=null}_setCanvasSize(e){if(!this.canvas)return;let{width:t,height:i}=e;if(t||t===0){let o=Number.isFinite(t)?`${t}px`:t;this.canvas.style.width=o}if(i||i===0){let o=Number.isFinite(i)?`${i}px`:i;this.canvas.style.position=e.style?.position||"absolute",this.canvas.style.height=o}}_updateCanvasSize(e=this._canvasContext){let{canvas:t}=this,[i,o]=e?e.getCSSSize():[t?.clientWidth??t?.width??0,t?.clientHeight??t?.height??0];(i!==this.width||o!==this.height)&&(this.width=i,this.height=o,this.viewManager?.setProps({width:i,height:o}),this.layerManager?.activateViewport(this.getViewports()[0]),this.props.onResize({width:i,height:o},e||void 0))}_onCanvasContextResize(e,t={}){if(t.syncDrawingBuffer){let{width:i,height:o}=e.canvas;e.setDrawingBufferSize(i,o)}this._needsRedraw="Canvas resized",this._updateCanvasSize(e)}_createAnimationLoop(e,t){let{gl:i,onError:o}=t;return new Vt({device:e,autoResizeDrawingBuffer:!i,autoResizeViewport:!1,onInitialize:n=>this._setDevice(n.device),onRender:this._onRenderFrame.bind(this),onError:o})}_createDevice(e){let t=this.props.deviceProps?.createCanvasContext,i=typeof t=="object"?t:void 0,o={adapters:[],_cacheShaders:!0,_cachePipelines:!0,...e.deviceProps};o.adapters.includes(Gi)||o.adapters.push(Gi);let n={alphaMode:this.props.deviceProps?.type==="webgpu"?"premultiplied":void 0};return Lt.createDevice({_reuseDevices:!0,type:"webgl",...o,createCanvasContext:{...n,...i,canvas:this._createCanvas(e),useDevicePixels:this.props.useDevicePixels,autoResize:!0}})}_getViewState(){return this.props.viewState||this.viewState}_getViews(){let{views:e}=this.props,t=Array.isArray(e)?e:e?[e]:[new un({id:"default-view"})];return t.length&&this.props.controller&&(t[0].props.controller=this.props.controller),t}_onContextLost(){let{onError:e}=this.props;this.animationLoop&&e&&e(new Error("WebGL context is lost"))}_pickAndCallback(){let{_pickRequest:e}=this;if(e.event){let t=e.event,i=this.layerManager?.getLayers()||[],o=this._getPointPickOptions(e.x,e.y,{radius:e.radius,mode:e.mode},i),n=this._getInternalPickingMode(),s=++this._hoverPickSequence;if(e.event=null,!n)return;if(n==="sync"){this._applyHoverCallbacks(this._pickPointSync(o),t);return}this._pickPointAsync(o).then(({result:a,emptyInfo:l})=>{s===this._hoverPickSequence&&this._applyHoverCallbacks({result:a,emptyInfo:l},t)}).catch(a=>this.props.onError?.(a))}}_updateCursor(){let e=this.props.parent||this.canvas;e&&(e.style.cursor=this.props.getCursor(this.cursorState))}_setDevice(e){if(this.device=e,this._validateInternalPickingMode(),!this.animationLoop)return;this._setDeviceCanvasContext(e,{syncDrawingBuffer:!!(this.props.gl&&this.props.device!==e)}),this.canvas&&!this.canvas.isConnected&&this.props.parent&&this.props.parent.insertBefore(this.canvas,this.props.parent.firstChild),this.device.type==="webgl"&&this.device.setParametersWebGL({blend:!0,blendFunc:[770,771,1,771],polygonOffsetFill:!0,depthTest:!0,depthFunc:515}),this.props.onDeviceInitialized(this.device),this.device.type==="webgl"&&this.props.onWebGLInitialized(this.device.gl);let t=new ke;t.play(),this.animationLoop.attachTimeline(t);let i=this.props.parent?.querySelector(".deck-events-root")||this.canvas;this.eventManager=new Bt(i,{touchAction:this.props.touchAction,recognizers:Object.keys(uo).map(s=>{let[a,l,c,f]=uo[s],u=this.props.eventRecognizerOptions?.[s],h={...l,...u,event:s};return{recognizer:new a(h),recognizeWith:c,requireFailure:f}}),events:{pointerdown:this._onPointerDown,pointermove:this._onPointerMove,pointerleave:this._onPointerMove}});for(let s in ot)this.eventManager.on(s,this._onEvent);this.viewManager=new si({timeline:t,eventManager:this.eventManager,onViewStateChange:this._onViewStateChange.bind(this),onInteractionStateChange:this._onInteractionStateChange.bind(this),pickPosition:this._pickPositionForController.bind(this),views:this._getViews(),viewState:this._getViewState(),width:this.width,height:this.height});let o=this.viewManager.getViewports()[0];this.layerManager=new ni(this.device,{deck:this,stats:this.stats,viewport:o,timeline:t}),this.effectManager=new gi({deck:this,device:this.device}),this.deckRenderer=new bi(this.device,{stats:this.stats}),this.deckPicker=new vi(this.device,{stats:this.stats});let n=this.props.parent?.querySelector(".deck-widgets-root")||this.canvas?.parentElement;this.widgetManager=new Fr({deck:this,parentElement:n}),this.widgetManager.addDefault(new yi),this.setProps({}),this._updateCanvasSize(this._canvasContext),this.props.onLoad()}_drawLayers(e,t){let{device:i,gl:o}=this.layerManager.context;this.props.onBeforeRender({device:i,gl:o});let n={target:this.props._framebuffer,layers:this.layerManager.getLayers(),viewports:this.viewManager.getViewports(),onViewportActive:this.layerManager.activateViewport,views:this.viewManager.getViews(),pass:"screen",effects:this.effectManager.getEffects(),...t};this.deckRenderer?.renderLayers(n),n.pass==="screen"&&this.widgetManager.onRedraw({viewports:n.viewports,layers:n.layers}),this.props.onAfterRender({device:i,gl:o})}_onRenderFrame(){this._getFrameStats(),this._metricsCounter++%60===0&&(this._getMetrics(),this.stats.reset(),M.table(4,this.metrics)(),this.props._onMetrics&&this.props._onMetrics(this.metrics)),this._updateCursor(),this.layerManager.updateLayers(),this._pickAndCallback(),this.redraw(),this.viewManager&&this.viewManager.updateViewStates()}_onViewStateChange(e){let t=this.props.onViewStateChange(e)||e.viewState;this.viewState&&(this.viewState={...this.viewState,[e.viewId]:t},this.props.viewState||this.viewManager&&this.viewManager.setProps({viewState:this.viewState}))}_onInteractionStateChange(e){this.cursorState.isDragging=e.isDragging||!1,this.props.onInteractionStateChange(e)}_getFrameStats(){let{stats:e}=this;e.get("frameRate").timeEnd(),e.get("frameRate").timeStart();let t=this.animationLoop.stats;e.get("GPU Time").addTime(t.get("GPU Time").lastTiming),e.get("CPU Time").addTime(t.get("CPU Time").lastTiming)}_getMetrics(){let{metrics:e,stats:t}=this;e.fps=t.get("frameRate").getHz(),e.setPropsTime=t.get("setProps Time").time,e.updateAttributesTime=t.get("Update Attributes").time,e.framesRedrawn=t.get("Redraw Count").count,e.pickTime=t.get("pickObject Time").time+t.get("pickMultipleObjects Time").time+t.get("pickObjects Time").time,e.pickCount=t.get("Pick Count").count,e.layersCount=this.layerManager?.layers.length??0,e.drawLayersCount=t.get("Layers rendered").lastSampleCount,e.pickLayersCount=t.get("Layers picked").lastSampleCount,e.updateAttributesCount=t.get("Layers updated").count,e.updateAttributesCount=t.get("Attributes updated").count,e.gpuTime=t.get("GPU Time").time,e.cpuTime=t.get("CPU Time").time,e.gpuTimePerFrame=t.get("GPU Time").getAverageTime(),e.cpuTimePerFrame=t.get("CPU Time").getAverageTime();let i=Lt.stats.get("GPU Time and Memory");e.bufferMemory=i.get("Buffer Memory").count,e.textureMemory=i.get("Texture Memory").count,e.renderbufferMemory=i.get("Renderbuffer Memory").count,e.gpuMemory=i.get("GPU Memory").count}};Si.defaultProps=Qa;Si.VERSION=Ja;var Ah=Si;var el=[],tl=[];function xi(r,e=0,t=1/0){let i=el,o={index:-1,data:r,target:[]};return r?typeof r[Symbol.iterator]=="function"?i=r:r.length>0&&(tl.length=r.length,i=tl):i=el,(e>0||Number.isFinite(t))&&(i=(Array.isArray(i)?i:Array.from(i)).slice(e,t),o.index=e-1),{iterable:i,objectInfo:o}}function zr(r){return r&&r[Symbol.asyncIterator]}function jr(r,e){let{size:t,stride:i,offset:o,startIndices:n,nested:s}=e,a=r.BYTES_PER_ELEMENT,l=i?i/a:t,c=o?o/a:0,f=Math.floor((r.length-c)/l);return(u,{index:h,target:p})=>{if(!n){let v=h*l+c;for(let y=0;y<t;y++)p[y]=r[v+y];return p}let d=n[h],g=n[h+1]||f,b;if(s){b=new Array(g-d);for(let v=d;v<g;v++){let y=v*l+c;p=new Array(t);for(let _=0;_<t;_++)p[_]=r[y+_];b[v-d]=p}}else if(l===t)b=r.subarray(d*t+c,g*t+c);else{b=new r.constructor((g-d)*t);let v=0;for(let y=d;y<g;y++){let _=y*l+c;for(let S=0;S<t;S++)b[v++]=r[_+S]}}return b}}function il(r){switch(r){case"float64":return Float64Array;case"uint8":case"unorm8":return Uint8ClampedArray;default:return Bn(r)}}var rl=Ct.getDataType.bind(Ct);function wi(r,e,t){if(e.size>4)return null;let i=t==="webgpu"&&e.type==="uint8"?"unorm8":e.type;return{attribute:r,format:e.size>1?`${i}x${e.size}`:e.type,byteOffset:e.offset||0}}function Ie(r){return r.stride||r.size*r.bytesPerElement}function ol(r,e){return r.type===e.type&&r.size===e.size&&Ie(r)===Ie(e)&&(r.offset||0)===(e.offset||0)}function gn(r,e){e.offset&&M.removed("shaderAttribute.offset","vertexOffset, elementOffset")();let t=Ie(r),i=e.vertexOffset!==void 0?e.vertexOffset:r.vertexOffset||0,o=e.elementOffset||0,n=i*t+o*r.bytesPerElement+(r.offset||0);return{...e,offset:n,stride:t}}function Ch(r,e){let t=gn(r,e);return{high:t,low:{...t,offset:t.offset+r.size*4}}}var Ei=class{constructor(e,t,i){this._buffer=null,this.device=e,this.id=t.id||"",this.size=t.size||1;let o=t.logicalType||t.type,n=o==="float64",{defaultValue:s}=t;s=Number.isFinite(s)?[s]:s||new Array(this.size).fill(0);let a;n?a="float32":!o&&t.isIndexed?a="uint32":a=o||"float32";let l=il(o||a);this.doublePrecision=n,n&&t.fp64===!1&&(l=Float32Array),this.value=null,this.settings={...t,defaultType:l,defaultValue:s,logicalType:o,type:a,normalized:a.includes("norm"),size:this.size,bytesPerElement:l.BYTES_PER_ELEMENT},this.state={...i,externalBuffer:null,bufferAccessor:this.settings,allocatedValue:null,numInstances:0,bounds:null,constant:!1}}get isConstant(){return this.state.constant}get buffer(){return this._buffer}get byteOffset(){let e=this.getAccessor();return e.vertexOffset?e.vertexOffset*Ie(e):0}get numInstances(){return this.state.numInstances}set numInstances(e){this.state.numInstances=e}delete(){this._buffer&&(this._buffer.delete(),this._buffer=null),se.release(this.state.allocatedValue)}getBuffer(){return this.state.constant?null:this.state.externalBuffer||this._buffer}getValue(e=this.id,t=null){let i={};if(this.state.constant){let o=this.value;if(t){let n=gn(this.getAccessor(),t),s=n.offset/o.BYTES_PER_ELEMENT,a=n.size||this.size;i[e]=o.subarray(s,s+a)}else i[e]=o}else i[e]=this.getBuffer();return this.doublePrecision&&(this.value instanceof Float64Array?i[`${e}64Low`]=i[e]:i[`${e}64Low`]=new Float32Array(this.size)),i}_getBufferLayout(e=this.id,t=null){let i=this.getAccessor(),o=[],n={name:this.id,byteStride:Ie(i)};if(this.doublePrecision){let s=Ch(i,t||{});o.push(wi(e,{...i,...s.high},this.device.type),wi(`${e}64Low`,{...i,...s.low},this.device.type))}else if(t){let s=gn(i,t);o.push(wi(e,{...i,...s},this.device.type))}else o.push(wi(e,i,this.device.type));return n.attributes=o.filter(Boolean),n}setAccessor(e){this.state.bufferAccessor=e}getAccessor(){return this.state.bufferAccessor}getBounds(){if(this.state.bounds)return this.state.bounds;let e=null;if(this.state.constant&&this.value){let t=Array.from(this.value);e=[t,t]}else{let{value:t,numInstances:i,size:o}=this,n=i*o;if(t&&n&&t.length>=n){let s=new Array(o).fill(1/0),a=new Array(o).fill(-1/0);for(let l=0;l<n;)for(let c=0;c<o;c++){let f=t[l++];f<s[c]&&(s[c]=f),f>a[c]&&(a[c]=f)}e=[s,a]}}return this.state.bounds=e,e}setData(e){let{state:t}=this,i;ArrayBuffer.isView(e)?i={value:e}:e instanceof U?i={buffer:e}:i=e;let o={...this.settings,...i};if(ArrayBuffer.isView(i.value)){if(!i.type)if(this.doublePrecision&&i.value instanceof Float64Array)o.type="float32";else{let s=rl(i.value);o.type=o.normalized?s.replace("int","norm"):s}o.bytesPerElement=i.value.BYTES_PER_ELEMENT,o.stride=Ie(o)}if(t.bounds=null,i.constant){let n=i.value;if(n=this._normalizeValue(n,[],0),this.settings.normalized&&(n=this.normalizeConstant(n)),!(!t.constant||!this._areValuesEqual(n,this.value)))return!1;t.externalBuffer=null,t.constant=!0,this.value=ArrayBuffer.isView(n)?n:new Float32Array(n)}else if(i.buffer){let n=i.buffer;t.externalBuffer=n,t.constant=!1,this.value=i.value||null}else if(i.value){this._checkExternalBuffer(i);let n=i.value;t.externalBuffer=null,t.constant=!1,this.value=n;let{buffer:s}=this,a=Ie(o),l=(o.vertexOffset||0)*a;if(this.doublePrecision&&n instanceof Float64Array&&(n=Ar(n,o)),this.settings.isIndexed){let f=this.settings.defaultType;n.constructor!==f&&(n=new f(n))}let c=n.byteLength+l+a*2;(!s||s.byteLength<c)&&(s=this._createBuffer(c)),s.write(n,l)}return this.setAccessor(o),!0}updateSubBuffer(e={}){this.state.bounds=null;let t=this.value,{startOffset:i=0,endOffset:o}=e;this.buffer.write(this.doublePrecision&&t instanceof Float64Array?Ar(t,{size:this.size,startIndex:i,endIndex:o}):t.subarray(i,o),i*t.BYTES_PER_ELEMENT+this.byteOffset)}allocate(e,t=!1){let{state:i}=this,o=i.allocatedValue,n=se.allocate(o,e+1,{size:this.size,type:this.settings.defaultType,copy:t});this.value=n;let{byteOffset:s}=this,{buffer:a}=this;return(!a||a.byteLength<n.byteLength+s)&&(a=this._createBuffer(n.byteLength+s),t&&o&&a.write(o instanceof Float64Array?Ar(o,this):o,s)),i.allocatedValue=n,i.constant=!1,i.externalBuffer=null,this.setAccessor(this.settings),!0}_checkExternalBuffer(e){let{value:t}=e;if(!ArrayBuffer.isView(t))throw new Error(`Attribute ${this.id} value is not TypedArray`);let i=this.settings.defaultType,o=!1;if(this.doublePrecision&&(o=t.BYTES_PER_ELEMENT<4),o)throw new Error(`Attribute ${this.id} does not support ${t.constructor.name}`);!(t instanceof i)&&this.settings.normalized&&!("normalized"in e)&&M.warn(`Attribute ${this.id} is normalized`)()}normalizeConstant(e){switch(this.settings.type){case"snorm8":return new Float32Array(e).map(t=>(t+128)/255*2-1);case"snorm16":return new Float32Array(e).map(t=>(t+32768)/65535*2-1);case"unorm8":return new Float32Array(e).map(t=>t/255);case"unorm16":return new Float32Array(e).map(t=>t/65535);default:return e}}_normalizeValue(e,t,i){let{defaultValue:o,size:n}=this.settings;if(Number.isFinite(e))return t[i]=e,t;if(!e){let s=n;for(;--s>=0;)t[i+s]=o[s];return t}switch(n){case 4:t[i+3]=Number.isFinite(e[3])?e[3]:o[3];case 3:t[i+2]=Number.isFinite(e[2])?e[2]:o[2];case 2:t[i+1]=Number.isFinite(e[1])?e[1]:o[1];case 1:t[i+0]=Number.isFinite(e[0])?e[0]:o[0];break;default:let s=n;for(;--s>=0;)t[i+s]=Number.isFinite(e[s])?e[s]:o[s]}return t}_areValuesEqual(e,t){if(!e||!t)return!1;let{size:i}=this;for(let o=0;o<i;o++)if(e[o]!==t[o])return!1;return!0}_createBuffer(e){this._buffer&&this._buffer.destroy();let{isIndexed:t,type:i}=this.settings;return this._buffer=this.device.createBuffer({...this._buffer?.props,id:this.id,usage:(t?U.INDEX:U.VERTEX)|U.COPY_DST,indexType:t?i:void 0,byteLength:e}),this._buffer}};var nl=[],Mi=[[0,1/0]];function sl(r,e){if(r===Mi||(e[0]<0&&(e[0]=0),e[0]>=e[1]))return r;let t=[],i=r.length,o=0;for(let n=0;n<i;n++){let s=r[n];s[1]<e[0]?(t.push(s),o=n+1):s[0]>e[1]?t.push(s):e=[Math.min(s[0],e[0]),Math.max(s[1],e[1])]}return t.splice(o,0,e),t}var Rh={interpolation:{duration:0,easing:r=>r},spring:{stiffness:.05,damping:.5}};function Gr(r,e){if(!r)return null;Number.isFinite(r)&&(r={type:"interpolation",duration:r});let t=r.type||"interpolation";return{...Rh[t],...e,...r,type:t}}var Je=class extends Ei{constructor(e,t){super(e,t,{startIndices:null,lastExternalBuffer:null,binaryValue:null,binaryAccessor:null,needsUpdate:!0,needsRedraw:!1,layoutChanged:!1,updateRanges:Mi}),this.constant=!1,this.settings.update=t.update||(t.accessor?this._autoUpdater:void 0),Object.seal(this.settings),Object.seal(this.state),this._validateAttributeUpdaters()}get startIndices(){return this.state.startIndices}set startIndices(e){this.state.startIndices=e}needsUpdate(){return this.state.needsUpdate}needsRedraw({clearChangedFlags:e=!1}={}){let t=this.state.needsRedraw;return this.state.needsRedraw=t&&!e,t}layoutChanged(){return this.state.layoutChanged}setAccessor(e){var t;(t=this.state).layoutChanged||(t.layoutChanged=!ol(e,this.getAccessor())),super.setAccessor(e)}getUpdateTriggers(){let{accessor:e}=this.settings;return[this.id].concat(typeof e!="function"&&e||[])}supportsTransition(){return!!this.settings.transition}getTransitionSetting(e){if(!e||!this.supportsTransition())return null;let{accessor:t}=this.settings,i=this.settings.transition,o=Array.isArray(t)?e[t.find(n=>e[n])]:e[t];return Gr(o,i)}setNeedsUpdate(e=this.id,t){if(this.state.needsUpdate=this.state.needsUpdate||e,this.setNeedsRedraw(e),t){let{startRow:i=0,endRow:o=1/0}=t;this.state.updateRanges=sl(this.state.updateRanges,[i,o])}else this.state.updateRanges=Mi}clearNeedsUpdate(){this.state.needsUpdate=!1,this.state.updateRanges=nl}setNeedsRedraw(e=this.id){this.state.needsRedraw=this.state.needsRedraw||e}allocate(e){let{state:t,settings:i}=this;return i.noAlloc?!1:i.update?(super.allocate(e,t.updateRanges!==Mi),!0):!1}updateBuffer({numInstances:e,data:t,props:i,context:o}){if(!this.needsUpdate())return!1;let{state:{updateRanges:n},settings:{update:s,noAlloc:a}}=this,l=!0;if(s){for(let[c,f]of n)s.call(o,this,{data:t,startRow:c,endRow:f,props:i,numInstances:e});if(this.value)if(this.constant||!this.buffer||this.buffer.byteLength<this.value.byteLength+this.byteOffset)this.constant?this.setConstantValue(o,this.value):this.setData({value:this.value,constant:this.constant}),this.constant=!1;else for(let[c,f]of n){let u=Number.isFinite(c)?this.getVertexOffset(c):0,h=Number.isFinite(f)?this.getVertexOffset(f):a||!Number.isFinite(e)?this.value.length:e*this.size;super.updateSubBuffer({startOffset:u,endOffset:h})}this._checkAttributeArray()}else l=!1;return this.clearNeedsUpdate(),this.setNeedsRedraw(),l}setConstantValue(e,t){if(t===void 0||typeof t=="function")return!1;let i=this.settings.transform&&e?this.settings.transform.call(e,t):t;return this.device.type==="webgpu"?this.setConstantBufferValue(i,this.numInstances):(this.setData({constant:!0,value:i})&&this.setNeedsRedraw(),this.clearNeedsUpdate(),!0)}setConstantBufferValue(e,t){let i=this.settings.defaultType,o=this._normalizeValue(e,new i(this.size),0);if(this._hasConstantBufferValue(o,t))return this.constant=!1,this.clearNeedsUpdate(),!1;let n=new i(Math.max(t,1)*this.size);for(let a=0;a<n.length;a+=this.size)n.set(o,a);let s=this.setData({value:n});return this.constant=!1,this.clearNeedsUpdate(),s&&this.setNeedsRedraw(),s}_hasConstantBufferValue(e,t){let i=this.value,o=Math.max(t,1)*this.size;if(!ArrayBuffer.isView(i)||i.length!==o||i.length%this.size!==0)return!1;for(let n=0;n<i.length;n+=this.size)for(let s=0;s<this.size;s++)if(i[n+s]!==e[s])return!1;return!0}setExternalBuffer(e){let{state:t}=this;return e?(this.clearNeedsUpdate(),t.lastExternalBuffer===e||(t.lastExternalBuffer=e,this.setNeedsRedraw(),this.setData(e)),!0):(t.lastExternalBuffer=null,!1)}setBinaryValue(e,t=null){let{state:i,settings:o}=this;if(!e)return i.binaryValue=null,i.binaryAccessor=null,!1;if(o.noAlloc)return!1;if(i.binaryValue===e)return this.clearNeedsUpdate(),!0;if(i.binaryValue=e,this.setNeedsRedraw(),o.transform||t!==this.startIndices){ArrayBuffer.isView(e)&&(e={value:e});let s=e;N(ArrayBuffer.isView(s.value),`invalid ${o.accessor}`);let a=!!s.size&&s.size!==this.size;return i.binaryAccessor=jr(s.value,{size:s.size||this.size,stride:s.stride,offset:s.offset,startIndices:t,nested:a}),!1}return this.clearNeedsUpdate(),this.setData(e),!0}getVertexOffset(e){let{startIndices:t}=this;return(t?e<t.length?t[e]:this.numInstances:e)*this.size}getValue(){let e=this.settings.shaderAttributes,t=super.getValue();if(!e)return t;for(let i in e)Object.assign(t,super.getValue(i,e[i]));return t}getBufferLayout(e){this.state.layoutChanged=!1;let t=this.settings.shaderAttributes,i=super._getBufferLayout(),{stepMode:o}=this.settings;if(o==="dynamic"?i.stepMode=e?e.isInstanced?"instance":"vertex":"instance":i.stepMode=o??"vertex",!t)return i;for(let n in t){let s=super._getBufferLayout(n,t[n]);i.attributes.push(...s.attributes)}return i}_autoUpdater(e,{data:t,startRow:i,endRow:o,props:n,numInstances:s}){let{settings:a,state:l,value:c,size:f,startIndices:u}=e,{accessor:h,transform:p}=a,d=l.binaryAccessor||(typeof h=="function"?h:n[h]);N(typeof d=="function",`accessor "${h}" is not a function`);let g=e.getVertexOffset(i),{iterable:b,objectInfo:v}=xi(t,i,o);for(let y of b){v.index++;let _=d(y,v);if(p&&(_=p.call(this,_)),u){let S=(v.index<u.length-1?u[v.index+1]:s)-u[v.index];if(_&&Array.isArray(_[0])){let P=g;for(let x of _)e._normalizeValue(x,c,P),P+=f}else _&&_.length>f?c.set(_,g):(e._normalizeValue(_,v.target,0),Zo({target:c,source:v.target,start:g,count:S}));g+=S*f}else e._normalizeValue(_,c,g),g+=f}}_validateAttributeUpdaters(){let{settings:e}=this;if(!(e.noAlloc||typeof e.update=="function"))throw new Error(`Attribute ${this.id} missing update or accessor`)}_checkAttributeArray(){let{value:e}=this,t=Math.min(4,this.size);if(e&&e.length>=t){let i=!0;switch(t){case 4:i=i&&Number.isFinite(e[3]);case 3:i=i&&Number.isFinite(e[2]);case 2:i=i&&Number.isFinite(e[1]);case 1:i=i&&Number.isFinite(e[0]);break;default:i=!1}if(!i)throw new Error(`Illegal attribute generated for ${this.id}`)}}};function _n(r){let{source:e,target:t,start:i=0,size:o,getData:n}=r,s=r.end||t.length,a=e.length,l=s-i;if(a>l){t.set(e.subarray(0,l),i);return}if(t.set(e,i),!n)return;let c=a;for(;c<l;){let f=n(c,e);for(let u=0;u<o;u++)t[i+c]=f[u]||0,c++}}function al({source:r,target:e,size:t,getData:i,sourceStartIndices:o,targetStartIndices:n}){if(!o||!n)return _n({source:r,target:e,size:t,getData:i}),e;let s=0,a=0,l=i&&((f,u)=>i(f+a,u)),c=Math.min(o.length,n.length);for(let f=1;f<c;f++){let u=o[f]*t,h=n[f]*t;_n({source:r.subarray(s,u),target:e,start:a,end:h,size:t,getData:l}),s=u,a=h}return a<e.length&&_n({source:[],target:e,start:a,size:t,getData:l}),e}function ll(r){let{device:e,settings:t,value:i}=r,o=new Je(e,t);return o.setData({value:i instanceof Float64Array?new Float64Array(0):new Float32Array(0),normalized:t.normalized}),o}function Hr(r){switch(r){case 1:return"float";case 2:return"vec2";case 3:return"vec3";case 4:return"vec4";default:throw new Error(`No defined attribute type for size "${r}"`)}}function Wr(r){switch(r){case 1:return"float32";case 2:return"float32x2";case 3:return"float32x3";case 4:return"float32x4";default:throw new Error("invalid type size")}}function $r(r){r.push(r.shift())}function cl(r,e){let{doublePrecision:t,settings:i,value:o,size:n}=r,s=t&&o instanceof Float64Array?2:1,a=0,{shaderAttributes:l}=r.settings;if(l)for(let c of Object.values(l))a=Math.max(a,c.vertexOffset??0);return(i.noAlloc?o.length:(e+a)*n)*s}function Yr({device:r,source:e,target:t}){return(!t||t.byteLength<e.byteLength)&&(t?.destroy(),t=r.createBuffer({byteLength:e.byteLength,usage:e.usage})),t}function qr({device:r,buffer:e,attribute:t,fromLength:i,toLength:o,fromStartIndices:n,getData:s=a=>a}){let a=t.doublePrecision&&t.value instanceof Float64Array?2:1,l=t.size*a,c=t.byteOffset,f=t.settings.bytesPerElement<4?c/t.settings.bytesPerElement*4:c,u=t.startIndices,h=n&&u,p=t.isConstant;if(!h&&e&&i>=o)return e;let d=t.value instanceof Float64Array?Float32Array:t.value.constructor,g=p?t.value:new d(t.getBuffer().readSyncWebGL(c,o*d.BYTES_PER_ELEMENT).buffer);if(t.settings.normalized&&!p){let _=s;s=(S,P)=>t.normalizeConstant(_(S,P))}let b=p?(_,S)=>s(g,S):(_,S)=>s(g.subarray(_+c,_+c+l),S),v=e?new Float32Array(e.readSyncWebGL(f,i*4).buffer):new Float32Array(0),y=new Float32Array(o);return al({source:v,target:y,sourceStartIndices:n,targetStartIndices:u,size:l,getData:b}),(!e||e.byteLength<y.byteLength+f)&&(e?.destroy(),e=r.createBuffer({byteLength:y.byteLength+f,usage:35050})),e.write(y,f),e}var wt=class{constructor({device:e,attribute:t,timeline:i}){this.buffers=[],this.currentLength=0,this.device=e,this.transition=new ae(i),this.attribute=t,this.attributeInTransition=ll(t),this.currentStartIndices=t.startIndices}get inProgress(){return this.transition.inProgress}start(e,t,i=1/0){this.settings=e,this.currentStartIndices=this.attribute.startIndices,this.currentLength=cl(this.attribute,t),this.transition.start({...e,duration:i})}update(){let e=this.transition.update();return e&&this.onUpdate(),e}setBuffer(e){this.attributeInTransition.setData({buffer:e,normalized:this.attribute.settings.normalized,value:this.attributeInTransition.value})}cancel(){this.transition.cancel()}delete(){this.cancel();for(let e of this.buffers)e.destroy();this.buffers.length=0}};var Pi=class extends wt{constructor({device:e,attribute:t,timeline:i}){super({device:e,attribute:t,timeline:i}),this.type="interpolation",this.transform=Uh(e,t)}start(e,t){let i=this.currentLength,o=this.currentStartIndices;if(super.start(e,t,e.duration),e.duration<=0){this.transition.cancel();return}let{buffers:n,attribute:s}=this;$r(n),n[0]=qr({device:this.device,buffer:n[0],attribute:s,fromLength:i,toLength:this.currentLength,fromStartIndices:o,getData:e.enter}),n[1]=Yr({device:this.device,source:n[0],target:n[1]}),this.setBuffer(n[1]);let{transform:a}=this,l=a.model,c=Math.floor(this.currentLength/s.size);ul(s)&&(c/=2),l.setVertexCount(c),s.isConstant?(l.setAttributes({aFrom:n[0]}),l.setConstantAttributes({aTo:s.value})):l.setAttributes({aFrom:n[0],aTo:s.getBuffer()}),a.transformFeedback.setBuffers({vCurrent:n[1]})}onUpdate(){let{duration:e,easing:t}=this.settings,{time:i}=this.transition,o=i/e;t&&(o=t(o));let{model:n}=this.transform,s={time:o};n.shaderInputs.setProps({interpolation:s}),this.transform.run({discard:!0})}delete(){super.delete(),this.transform.destroy()}},Ih=`layout(std140) uniform interpolationUniforms {
  float time;
} interpolation;
`,fl={name:"interpolation",vs:Ih,uniformTypes:{time:"f32"}},Oh=`#version 300 es
#define SHADER_NAME interpolation-transition-vertex-shader

in ATTRIBUTE_TYPE aFrom;
in ATTRIBUTE_TYPE aTo;
out ATTRIBUTE_TYPE vCurrent;

void main(void) {
  vCurrent = mix(aFrom, aTo, interpolation.time);
  gl_Position = vec4(0.0);
}
`,Nh=`#version 300 es
#define SHADER_NAME interpolation-transition-vertex-shader

in ATTRIBUTE_TYPE aFrom;
in ATTRIBUTE_TYPE aFrom64Low;
in ATTRIBUTE_TYPE aTo;
in ATTRIBUTE_TYPE aTo64Low;
out ATTRIBUTE_TYPE vCurrent;
out ATTRIBUTE_TYPE vCurrent64Low;

vec2 mix_fp64(vec2 a, vec2 b, float x) {
  vec2 range = sub_fp64(b, a);
  return sum_fp64(a, mul_fp64(range, vec2(x, 0.0)));
}

void main(void) {
  for (int i=0; i<ATTRIBUTE_SIZE; i++) {
    vec2 value = mix_fp64(vec2(aFrom[i], aFrom64Low[i]), vec2(aTo[i], aTo64Low[i]), interpolation.time);
    vCurrent[i] = value.x;
    vCurrent64Low[i] = value.y;
  }
  gl_Position = vec4(0.0);
}
`;function ul(r){return r.doublePrecision&&r.value instanceof Float64Array}function Uh(r,e){let t=e.size,i=Hr(t),o=Wr(t),n=e.getBufferLayout();return ul(e)?new Te(r,{vs:Nh,bufferLayout:[{name:"aFrom",byteStride:8*t,attributes:[{attribute:"aFrom",format:o,byteOffset:0},{attribute:"aFrom64Low",format:o,byteOffset:4*t}]},{name:"aTo",byteStride:8*t,attributes:[{attribute:"aTo",format:o,byteOffset:0},{attribute:"aTo64Low",format:o,byteOffset:4*t}]}],modules:[Ro,fl],defines:{ATTRIBUTE_TYPE:i,ATTRIBUTE_SIZE:t},moduleSettings:{},varyings:["vCurrent","vCurrent64Low"],bufferMode:35980,disableWarnings:!0}):new Te(r,{vs:Oh,bufferLayout:[{name:"aFrom",format:o},{name:"aTo",format:n.attributes[0].format}],modules:[fl],defines:{ATTRIBUTE_TYPE:i},varyings:["vCurrent"],disableWarnings:!0})}var Ti=class extends wt{constructor({device:e,attribute:t,timeline:i}){super({device:e,attribute:t,timeline:i}),this.type="spring",this.texture=zh(e),this.framebuffer=jh(e,this.texture),this.transform=Fh(e,t)}start(e,t){let i=this.currentLength,o=this.currentStartIndices;super.start(e,t);let{buffers:n,attribute:s}=this;for(let l=0;l<2;l++)n[l]=qr({device:this.device,buffer:n[l],attribute:s,fromLength:i,toLength:this.currentLength,fromStartIndices:o,getData:e.enter});n[2]=Yr({device:this.device,source:n[0],target:n[2]}),this.setBuffer(n[1]);let{model:a}=this.transform;a.setVertexCount(Math.floor(this.currentLength/s.size)),s.isConstant?a.setConstantAttributes({aTo:s.value}):a.setAttributes({aTo:s.getBuffer()})}onUpdate(){let{buffers:e,transform:t,framebuffer:i,transition:o}=this,n=this.settings;t.model.setAttributes({aPrev:e[0],aCur:e[1]}),t.transformFeedback.setBuffers({vNext:e[2]});let s={stiffness:n.stiffness,damping:n.damping};t.model.shaderInputs.setProps({spring:s}),t.run({framebuffer:i,discard:!1,parameters:{viewport:[0,0,1,1]},clearColor:[0,0,0,0]}),$r(e),this.setBuffer(e[1]),this.device.readPixelsToArrayWebGL(i)[0]>0||o.end()}delete(){super.delete(),this.transform.destroy(),this.texture.destroy(),this.framebuffer.destroy()}},Dh=`layout(std140) uniform springUniforms {
  float damping;
  float stiffness;
} spring;
`,kh={name:"spring",vs:Dh,uniformTypes:{damping:"f32",stiffness:"f32"}},Bh=`#version 300 es
#define SHADER_NAME spring-transition-vertex-shader

#define EPSILON 0.00001

in ATTRIBUTE_TYPE aPrev;
in ATTRIBUTE_TYPE aCur;
in ATTRIBUTE_TYPE aTo;
out ATTRIBUTE_TYPE vNext;
out float vIsTransitioningFlag;

ATTRIBUTE_TYPE getNextValue(ATTRIBUTE_TYPE cur, ATTRIBUTE_TYPE prev, ATTRIBUTE_TYPE dest) {
  ATTRIBUTE_TYPE velocity = cur - prev;
  ATTRIBUTE_TYPE delta = dest - cur;
  ATTRIBUTE_TYPE force = delta * spring.stiffness;
  ATTRIBUTE_TYPE resistance = velocity * spring.damping;
  return force - resistance + velocity + cur;
}

void main(void) {
  bool isTransitioning = length(aCur - aPrev) > EPSILON || length(aTo - aCur) > EPSILON;
  vIsTransitioningFlag = isTransitioning ? 1.0 : 0.0;

  vNext = getNextValue(aCur, aPrev, aTo);
  gl_Position = vec4(0, 0, 0, 1);
  gl_PointSize = 100.0;
}
`,Vh=`#version 300 es
#define SHADER_NAME spring-transition-is-transitioning-fragment-shader

in float vIsTransitioningFlag;

out vec4 fragColor;

void main(void) {
  if (vIsTransitioningFlag == 0.0) {
    discard;
  }
  fragColor = vec4(1.0);
}`;function Fh(r,e){let t=Hr(e.size),i=Wr(e.size);return new Te(r,{vs:Bh,fs:Vh,bufferLayout:[{name:"aPrev",format:i},{name:"aCur",format:i},{name:"aTo",format:e.getBufferLayout().attributes[0].format}],varyings:["vNext"],modules:[kh],defines:{ATTRIBUTE_TYPE:t},parameters:{depthCompare:"always",blendColorOperation:"max",blendColorSrcFactor:"one",blendColorDstFactor:"one",blendAlphaOperation:"max",blendAlphaSrcFactor:"one",blendAlphaDstFactor:"one"}})}function zh(r){return r.createTexture({data:new Uint8Array(4),format:"rgba8unorm",width:1,height:1})}function jh(r,e){return r.createFramebuffer({id:"spring-transition-is-transitioning-framebuffer",width:1,height:1,colorAttachments:[e]})}var Gh={interpolation:Pi,spring:Ti},Ai=class{constructor(e,{id:t,timeline:i}){if(!e)throw new Error("AttributeTransitionManager is constructed without device");this.id=t,this.device=e,this.timeline=i,this.transitions={},this.needsRedraw=!1,this.numInstances=1}finalize(){for(let e in this.transitions)this._removeTransition(e)}update({attributes:e,transitions:t,numInstances:i}){this.numInstances=i||1;for(let o in e){let n=e[o],s=n.getTransitionSetting(t);s&&this._updateAttribute(o,n,s)}for(let o in this.transitions){let n=e[o];(!n||!n.getTransitionSetting(t))&&this._removeTransition(o)}}hasAttribute(e){let t=this.transitions[e];return t&&t.inProgress}getAttributes(){let e={};for(let t in this.transitions){let i=this.transitions[t];i.inProgress&&(e[t]=i.attributeInTransition)}return e}run(){if(this.numInstances===0)return!1;for(let t in this.transitions)this.transitions[t].update()&&(this.needsRedraw=!0);let e=this.needsRedraw;return this.needsRedraw=!1,e}_removeTransition(e){this.transitions[e].delete(),delete this.transitions[e]}_updateAttribute(e,t,i){let o=this.transitions[e],n=!o||o.type!==i.type;if(n){o&&this._removeTransition(e);let s=Gh[i.type];s?this.transitions[e]=new s({attribute:t,timeline:this.timeline,device:this.device}):(M.error(`unsupported transition type '${i.type}'`)(),n=!1)}(n||t.needsRedraw())&&(this.needsRedraw=!0,this.transitions[e].start(i,this.numInstances))}};var hl="attributeManager.invalidate",Hh="attributeManager.updateStart",Wh="attributeManager.updateEnd",$h="attribute.updateStart",Yh="attribute.allocate",qh="attribute.updateEnd",Ci=class{constructor(e,{id:t="attribute-manager",stats:i,timeline:o}={}){this.mergeBoundsMemoized=fe(Ua),this.id=t,this.device=e,this.attributes={},this.updateTriggers={},this.needsRedraw=!0,this.userData={},this.stats=i,this.attributeTransitionManager=new Ai(e,{id:`${t}-transitions`,timeline:o}),Object.seal(this)}finalize(){for(let e in this.attributes)this.attributes[e].delete();this.attributeTransitionManager.finalize()}getNeedsRedraw(e={clearRedrawFlags:!1}){let t=this.needsRedraw;return this.needsRedraw=this.needsRedraw&&!e.clearRedrawFlags,t&&this.id}setNeedsRedraw(){this.needsRedraw=!0}add(e){this._add(e)}addInstanced(e){this._add(e,{stepMode:"instance"})}remove(e){for(let t of e)this.attributes[t]!==void 0&&(this.attributes[t].delete(),delete this.attributes[t])}invalidate(e,t){let i=this._invalidateTrigger(e,t);V(hl,this,e,i)}invalidateAll(e){for(let t in this.attributes)this.attributes[t].setNeedsUpdate(t,e);V(hl,this,"all")}update({data:e,numInstances:t,startIndices:i=null,transitions:o,props:n={},buffers:s={},context:a={}}){let l=!1;V(Hh,this),this.stats&&this.stats.get("Update Attributes").timeStart();for(let c in this.attributes){let f=this.attributes[c],u=f.settings.accessor;f.startIndices=i,f.numInstances=t,n[c]&&M.removed(`props.${c}`,`data.attributes.${c}`)(),f.setExternalBuffer(s[c])||f.setBinaryValue(typeof u=="string"?s[u]:void 0,e.startIndices)||typeof u=="string"&&!s[u]&&f.setConstantValue(a,n[u])||f.needsUpdate()&&(l=!0,this._updateAttribute({attribute:f,numInstances:t,data:e,props:n,context:a})),this.needsRedraw=this.needsRedraw||f.needsRedraw()}l&&V(Wh,this,t),this.stats&&(this.stats.get("Update Attributes").timeEnd(),l&&this.stats.get("Attributes updated").incrementCount()),this.attributeTransitionManager.update({attributes:this.attributes,numInstances:t,transitions:o})}updateTransition(){let{attributeTransitionManager:e}=this,t=e.run();return this.needsRedraw=this.needsRedraw||t,t}getAttributes(){return{...this.attributes,...this.attributeTransitionManager.getAttributes()}}getBounds(e){let t=e.map(i=>this.attributes[i]?.getBounds());return this.mergeBoundsMemoized(t)}getChangedAttributes(e={clearChangedFlags:!1}){let{attributes:t,attributeTransitionManager:i}=this,o={...i.getAttributes()};for(let n in t){let s=t[n];s.needsRedraw(e)&&!i.hasAttribute(n)&&(o[n]=s)}return o}getBufferLayouts(e){return Object.values(this.getAttributes()).map(t=>t.getBufferLayout(e))}_add(e,t){for(let i in e){let o=e[i],n={...o,id:i,size:o.isIndexed&&1||o.size||1,...t};this.attributes[i]=new Je(this.device,n)}this._mapUpdateTriggersToAttributes()}_mapUpdateTriggersToAttributes(){let e={};for(let t in this.attributes)this.attributes[t].getUpdateTriggers().forEach(o=>{e[o]||(e[o]=[]),e[o].push(t)});this.updateTriggers=e}_invalidateTrigger(e,t){let{attributes:i,updateTriggers:o}=this,n=o[e];return n&&n.forEach(s=>{let a=i[s];a&&a.setNeedsUpdate(a.id,t)}),n}_updateAttribute(e){let{attribute:t,numInstances:i}=e;if(V($h,t),t.constant){t.setConstantValue(e.context,t.value);return}t.allocate(i)&&V(Yh,t,i),t.updateBuffer(e)&&(this.needsRedraw=!0,V(qh,t,i))}};var Li=class extends ae{get value(){return this._value}_onUpdate(){let{time:e,settings:{fromValue:t,toValue:i,duration:o,easing:n}}=this,s=n(e/o);this._value=Tt(t,i,s)}};var pl=1e-5;function dl(r,e,t,i,o){let n=e-r,a=(t-e)*o,l=-n*i;return a+l+n+e}function Xh(r,e,t,i,o){if(Array.isArray(t)){let n=[];for(let s=0;s<t.length;s++)n[s]=dl(r[s],e[s],t[s],i,o);return n}return dl(r,e,t,i,o)}function ml(r,e){if(Array.isArray(r)){let t=0;for(let i=0;i<r.length;i++){let o=r[i]-e[i];t+=o*o}return Math.sqrt(t)}return Math.abs(r-e)}var Ri=class extends ae{get value(){return this._currValue}_onUpdate(){let{fromValue:e,toValue:t,damping:i,stiffness:o}=this.settings,{_prevValue:n=e,_currValue:s=e}=this,a=Xh(n,s,t,i,o),l=ml(a,t),c=ml(a,s);l<pl&&c<pl&&(a=t,this.end()),this._prevValue=s,this._currValue=a}};var Zh={interpolation:Li,spring:Ri},Ii=class{constructor(e){this.transitions=new Map,this.timeline=e}get active(){return this.transitions.size>0}add(e,t,i,o){let{transitions:n}=this;if(n.has(e)){let l=n.get(e),{value:c=l.settings.fromValue}=l;t=c,this.remove(e)}if(o=Gr(o),!o)return;let s=Zh[o.type];if(!s){M.error(`unsupported transition type '${o.type}'`)();return}let a=new s(this.timeline);a.start({...o,fromValue:t,toValue:i}),n.set(e,a)}remove(e){let{transitions:t}=this;t.has(e)&&(t.get(e).cancel(),t.delete(e))}update(){let e={};for(let[t,i]of this.transitions)i.update(),e[t]=i.value,i.inProgress||this.remove(t);return e}clear(){for(let e of this.transitions.keys())this.remove(e)}};function _l(r){let e=r[J];for(let t in e){let i=e[t],{validate:o}=i;if(o&&!o(r[t],i))throw new Error(`Invalid prop ${t}: ${r[t]}`)}}function bl(r,e){let t=vl({newProps:r,oldProps:e,propTypes:r[J],ignoreProps:{data:null,updateTriggers:null,extensions:null,transitions:null}}),i=Jh(r,e),o=!1;return i||(o=Qh(r,e)),{dataChanged:i,propsChanged:t,updateTriggersChanged:o,extensionsChanged:ep(r,e),transitionsChanged:Kh(r,e)}}function Kh(r,e){if(!r.transitions)return!1;let t={},i=r[J],o=!1;for(let n in r.transitions){let s=i[n],a=s&&s.type;(a==="number"||a==="color"||a==="array")&&bn(r[n],e[n],s)&&(t[n]=!0,o=!0)}return o?t:!1}function vl({newProps:r,oldProps:e,ignoreProps:t={},propTypes:i={},triggerName:o="props"}){if(e===r)return!1;if(typeof r!="object"||r===null)return`${o} changed shallowly`;if(typeof e!="object"||e===null)return`${o} changed shallowly`;for(let n of Object.keys(r))if(!(n in t)){if(!(n in e))return`${o}.${n} added`;let s=bn(r[n],e[n],i[n]);if(s)return`${o}.${n} ${s}`}for(let n of Object.keys(e))if(!(n in t)){if(!(n in r))return`${o}.${n} dropped`;if(!Object.hasOwnProperty.call(r,n)){let s=bn(r[n],e[n],i[n]);if(s)return`${o}.${n} ${s}`}}return!1}function bn(r,e,t){let i=t&&t.equal;return i&&!i(r,e,t)||!i&&(i=r&&e&&r.equals,i&&!i.call(r,e))?"changed deeply":!i&&e!==r?"changed shallowly":null}function Jh(r,e){if(e===null)return"oldProps is null, initial diff";let t=!1,{dataComparator:i,_dataDiff:o}=r;return i?i(r.data,e.data)||(t="Data comparator detected a change"):r.data!==e.data&&(t="A new data container was supplied"),t&&o&&(t=o(r.data,e.data)||t),t}function Qh(r,e){if(e===null)return{all:!0};if("all"in r.updateTriggers&&gl(r,e,"all"))return{all:!0};let t={},i=!1;for(let o in r.updateTriggers)o!=="all"&&gl(r,e,o)&&(t[o]=!0,i=!0);return i?t:!1}function ep(r,e){if(e===null)return!0;let t=e.extensions,{extensions:i}=r;if(i===t)return!1;if(!t||!i||i.length!==t.length)return!0;for(let o=0;o<i.length;o++)if(!i[o].equals(t[o]))return!0;return!1}function gl(r,e,t){let i=r.updateTriggers[t];i=i??{};let o=e.updateTriggers[t];return o=o??{},vl({oldProps:o,newProps:i,triggerName:t})}var tp="count(): argument not an object",ip="count(): argument not a container";function yl(r){if(!op(r))throw new Error(tp);if(typeof r.count=="function")return r.count();if(Number.isFinite(r.size))return r.size;if(Number.isFinite(r.length))return r.length;if(rp(r))return Object.keys(r).length;throw new Error(ip)}function rp(r){return r!==null&&typeof r=="object"&&r.constructor===Object}function op(r){return r!==null&&typeof r=="object"}function vn(r,e){if(!e)return r;let t={...r,...e};if("defines"in e&&(t.defines={...r.defines,...e.defines}),"modules"in e&&(t.modules=(r.modules||[]).concat(e.modules),e.modules.some(i=>i.name==="project64"))){let i=t.modules.findIndex(o=>o.name==="project32");i>=0&&t.modules.splice(i,1)}if("inject"in e)if(!r.inject)t.inject=e.inject;else{let i={...r.inject};for(let o in e.inject)i[o]=(i[o]||"")+e.inject[o];t.inject=i}return t}var Sl=[0,0,0];function yn(r,e,t=!1){let i=e.projectPosition(r);if(t&&e instanceof qe){let[o,n,s=0]=r,a=e.getDistanceScales([o,n]);i[2]=s*a.unitsPerMeter[2]}return i}function np(r){let{viewport:e,modelMatrix:t,coordinateOrigin:i}=r,{coordinateSystem:o,fromCoordinateSystem:n,fromCoordinateOrigin:s}=r;return o==="default"&&(o=e.isGeospatial?"lnglat":"cartesian"),n===void 0?n=o:n==="default"&&(n=e.isGeospatial?"lnglat":"cartesian"),s===void 0&&(s=i),{viewport:e,coordinateSystem:o,coordinateOrigin:i,modelMatrix:t,fromCoordinateSystem:n,fromCoordinateOrigin:s}}function Xr(r,{viewport:e,modelMatrix:t,coordinateSystem:i,coordinateOrigin:o,offsetMode:n}){let[s,a,l=0]=r;switch(t&&([s,a,l]=te.transformMat4([],[s,a,l,1],t)),i){case"default":return Xr(r,{viewport:e,modelMatrix:t,coordinateSystem:e.isGeospatial?"lnglat":"cartesian",coordinateOrigin:o,offsetMode:n});case"lnglat":return yn([s,a,l],e,n);case"lnglat-offsets":return yn([s+o[0],a+o[1],l+(o[2]||0)],e,n);case"meter-offsets":return yn(ei(o,[s,a,l]),e,n);case"cartesian":return e.isGeospatial?[s+o[0],a+o[1],l+o[2]]:e.projectPosition([s,a,l]);default:throw new Error(`Invalid coordinateSystem: ${i}`)}}function xl(r,e){let{viewport:t,coordinateSystem:i,coordinateOrigin:o,modelMatrix:n,fromCoordinateSystem:s,fromCoordinateOrigin:a}=np(e),{autoOffset:l=!0}=e,{geospatialOrigin:c=Sl,shaderCoordinateOrigin:f=Sl,offsetMode:u=!1}=l?Jo(t,i,o):{},h=Xr(r,{viewport:t,modelMatrix:n,coordinateSystem:s,coordinateOrigin:a,offsetMode:u});if(u){let p=t.projectPosition(c||f);ee.sub(h,h,p)}return h}var sp={minFilter:"linear",mipmapFilter:"linear",magFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"},Sn={};function wl(r,e,t,i){if(t instanceof k)return t;t.constructor&&t.constructor.name!=="Object"&&(t={data:t});let o=null;t.compressed&&(o={minFilter:"linear",mipmapFilter:t.data.length>1?"nearest":"linear"});let{width:n,height:s}=t.data,a=e.createTexture({...t,sampler:{...sp,...o,...i},mipLevels:e.getMipLevelCount(n,s)});return e.type==="webgl"?a.generateMipmapsWebGL():e.type==="webgpu"&&e.generateMipmapsWebGPU(a),Sn[a.id]=r,a}function El(r,e){!e||!(e instanceof k)||Sn[e.id]===r&&(e.delete(),delete Sn[e.id])}var ap={boolean:{validate(r,e){return!0},equal(r,e,t){return!!r==!!e}},number:{validate(r,e){return Number.isFinite(r)&&(!("max"in e)||r<=e.max)&&(!("min"in e)||r>=e.min)}},color:{validate(r,e){return e.optional&&!r||xn(r)&&(r.length===3||r.length===4)},equal(r,e,t){return B(r,e,1)}},accessor:{validate(r,e){let t=Zr(r);return t==="function"||t===Zr(e.value)},equal(r,e,t){return typeof e=="function"?!0:B(r,e,1)}},array:{validate(r,e){return e.optional&&!r||xn(r)},equal(r,e,t){let{compare:i}=t,o=Number.isInteger(i)?i:i?1:0;return i?B(r,e,o):r===e}},object:{equal(r,e,t){if(t.ignore)return!0;let{compare:i}=t,o=Number.isInteger(i)?i:i?1:0;return i?B(r,e,o):r===e}},function:{validate(r,e){return e.optional&&!r||typeof r=="function"},equal(r,e,t){return!t.compare&&t.ignore!==!1||r===e}},data:{transform:(r,e,t)=>{if(!r)return r;let{dataTransform:i}=t.props;return i?i(r):typeof r.shape=="string"&&r.shape.endsWith("-table")&&Array.isArray(r.data)?r.data:r}},image:{transform:(r,e,t)=>{let i=t.context;return!i||!i.device?null:wl(t.id,i.device,r,{...e.parameters,...t.props.textureParameters})},release:(r,e,t)=>{El(t.id,r)}}};function Ml(r){let e={},t={},i={};for(let[o,n]of Object.entries(r)){let s=n?.deprecatedFor;if(s)i[o]=Array.isArray(s)?s:[s];else{let a=lp(o,n);e[o]=a,t[o]=a.value}}return{propTypes:e,defaultProps:t,deprecatedProps:i}}function lp(r,e){switch(Zr(e)){case"object":return Oi(r,e);case"array":return Oi(r,{type:"array",value:e,compare:!1});case"boolean":return Oi(r,{type:"boolean",value:e});case"number":return Oi(r,{type:"number",value:e});case"function":return Oi(r,{type:"function",value:e,compare:!0});default:return{name:r,type:"unknown",value:e}}}function Oi(r,e){return"type"in e?{name:r,...ap[e.type],...e}:"value"in e?{name:r,type:Zr(e.value),...e}:{name:r,type:"object",value:e}}function xn(r){return Array.isArray(r)||ArrayBuffer.isView(r)}function Zr(r){return xn(r)?"array":r===null?"null":typeof r}function Pl(r,e){let t;for(let n=e.length-1;n>=0;n--){let s=e[n];"extensions"in s&&(t=s.extensions)}let i=wn(r.constructor,t),o=Object.create(i);o[gt]=r,o[ue]={},o[ne]={};for(let n=0;n<e.length;++n){let s=e[n];for(let a in s)o[a]=s[a]}return Object.freeze(o),o}var cp="_mergedDefaultProps";function wn(r,e){if(!(r instanceof Kr.constructor))return{};let t=cp;if(e)for(let o of e){let n=o.constructor;n&&(t+=`:${n.extensionName||n.name}`)}let i=Tl(r,t);return i||(r[t]=fp(r,e||[]))}function fp(r,e){if(!r.prototype)return null;let i=Object.getPrototypeOf(r),o=wn(i),n=Tl(r,"defaultProps")||{},s=Ml(n),a=Object.assign(Object.create(null),o,s.defaultProps),l=Object.assign(Object.create(null),o?.[J],s.propTypes),c=Object.assign(Object.create(null),o?.[Tr],s.deprecatedProps);for(let f of e){let u=wn(f.constructor);u&&(Object.assign(a,u),Object.assign(l,u[J]),Object.assign(c,u[Tr]))}return up(a,r),pp(a,l),hp(a,c),a[J]=l,a[Tr]=c,e.length===0&&!En(r,"_propTypes")&&(r._propTypes=l),a}function up(r,e){let t=mp(e);Object.defineProperties(r,{id:{writable:!0,value:t}})}function hp(r,e){for(let t in e)Object.defineProperty(r,t,{enumerable:!1,set(i){let o=`${this.id}: ${t}`;for(let n of e[t])En(this,n)||(this[n]=i);M.deprecated(o,e[t].join("/"))()}})}function pp(r,e){let t={},i={};for(let o in e){let n=e[o],{name:s,value:a}=n;n.async&&(t[s]=a,i[s]=dp(s))}r[ge]=t,r[ue]={},Object.defineProperties(r,i)}function dp(r){return{enumerable:!0,set(e){typeof e=="string"||e instanceof Promise||zr(e)?this[ue][r]=e:this[ne][r]=e},get(){if(this[ne]){if(r in this[ne])return this[ne][r]||this[ge][r];if(r in this[ue]){let e=this[gt]&&this[gt].internalState;if(e&&e.hasAsyncProp(r))return e.getAsyncProp(r)||this[ge][r]}}return this[ge][r]}}}function En(r,e){return Object.prototype.hasOwnProperty.call(r,e)}function Tl(r,e){return En(r,e)&&r[e]}function mp(r){let e=r.componentName;return e||M.warn(`${r.name}.componentName not specified`)(),e||r.name}var gp=0,Ni=class{constructor(...e){this.props=Pl(this,e),this.id=this.props.id,this.count=gp++}clone(e){let{props:t}=this,i={};for(let o in t[ge])o in t[ne]?i[o]=t[ne][o]:o in t[ue]&&(i[o]=t[ue][o]);return new this.constructor({...t,...i,...e})}};Ni.componentName="Component";Ni.defaultProps={};var Kr=Ni;var _p=Object.freeze({}),Ui=class{constructor(e){this.component=e,this.asyncProps={},this.onAsyncPropUpdated=()=>{},this.oldProps=null,this.oldAsyncProps=null}finalize(){for(let e in this.asyncProps){let t=this.asyncProps[e];t&&t.type&&t.type.release&&t.type.release(t.resolvedValue,t.type,this.component)}this.asyncProps={},this.component=null,this.resetOldProps()}getOldProps(){return this.oldAsyncProps||this.oldProps||_p}resetOldProps(){this.oldAsyncProps=null,this.oldProps=this.component?this.component.props:null}hasAsyncProp(e){return e in this.asyncProps}getAsyncProp(e){let t=this.asyncProps[e];return t&&t.resolvedValue}isAsyncPropLoading(e){if(e){let t=this.asyncProps[e];return!!(t&&t.pendingLoadCount>0&&t.pendingLoadCount!==t.resolvedLoadCount)}for(let t in this.asyncProps)if(this.isAsyncPropLoading(t))return!0;return!1}reloadAsyncProp(e,t){this._watchPromise(e,Promise.resolve(t))}setAsyncProps(e){this.component=e[gt]||this.component;let t=e[ne]||{},i=e[ue]||e,o=e[ge]||{};for(let n in t){let s=t[n];this._createAsyncPropData(n,o[n]),this._updateAsyncProp(n,s),t[n]=this.getAsyncProp(n)}for(let n in i){let s=i[n];this._createAsyncPropData(n,o[n]),this._updateAsyncProp(n,s)}}_fetch(e,t){return null}_onResolve(e,t){}_onError(e,t){}_updateAsyncProp(e,t){if(this._didAsyncInputValueChange(e,t)){if(typeof t=="string"&&(t=this._fetch(e,t)),t instanceof Promise){this._watchPromise(e,t);return}if(zr(t)){this._resolveAsyncIterable(e,t);return}this._setPropValue(e,t)}}_freezeAsyncOldProps(){if(!this.oldAsyncProps&&this.oldProps){this.oldAsyncProps=Object.create(this.oldProps);for(let e in this.asyncProps)Object.defineProperty(this.oldAsyncProps,e,{enumerable:!0,value:this.oldProps[e]})}}_didAsyncInputValueChange(e,t){let i=this.asyncProps[e];return t===i.resolvedValue||t===i.lastValue?!1:(i.lastValue=t,!0)}_setPropValue(e,t){this._freezeAsyncOldProps();let i=this.asyncProps[e];i&&(t=this._postProcessValue(i,t),i.resolvedValue=t,i.pendingLoadCount++,i.resolvedLoadCount=i.pendingLoadCount)}_setAsyncPropValue(e,t,i){let o=this.asyncProps[e];o&&i>=o.resolvedLoadCount&&t!==void 0&&(this._freezeAsyncOldProps(),o.resolvedValue=t,o.resolvedLoadCount=i,this.onAsyncPropUpdated(e,t))}_watchPromise(e,t){let i=this.asyncProps[e];if(i){i.pendingLoadCount++;let o=i.pendingLoadCount;t.then(n=>{this.component&&(n=this._postProcessValue(i,n),this._setAsyncPropValue(e,n,o),this._onResolve(e,n))}).catch(n=>{this._onError(e,n)})}}async _resolveAsyncIterable(e,t){if(e!=="data"){this._setPropValue(e,t);return}let i=this.asyncProps[e];if(!i)return;i.pendingLoadCount++;let o=i.pendingLoadCount,n=[],s=0;for await(let a of t){if(!this.component)return;let{dataTransform:l}=this.component.props;l?n=l(a,n):n=n.concat(a),Object.defineProperty(n,"__diff",{enumerable:!1,value:[{startRow:s,endRow:n.length}]}),s=n.length,this._setAsyncPropValue(e,n,o)}this._onResolve(e,n)}_postProcessValue(e,t){let i=e.type;return i&&this.component&&(i.release&&i.release(e.resolvedValue,i,this.component),i.transform)?i.transform(t,i,this.component):t}_createAsyncPropData(e,t){if(!this.asyncProps[e]){let o=this.component&&this.component.props[J];this.asyncProps[e]={type:o&&o[e],lastValue:null,resolvedValue:t,pendingLoadCount:0,resolvedLoadCount:0}}}};var Di=class extends Ui{constructor({attributeManager:e,layer:t}){super(t),this.attributeManager=e,this.needsRedraw=!0,this.needsUpdate=!0,this.subLayers=null,this.usesPickingColorCache=!1}get layer(){return this.component}_fetch(e,t){let i=this.layer,o=i?.props.fetch;return o?o(t,{propName:e,layer:i}):super._fetch(e,t)}_onResolve(e,t){let i=this.layer;if(i){let o=i.props.onDataLoad;e==="data"&&o&&o(t,{propName:e,layer:i})}}_onError(e,t){let i=this.layer;i&&i.raiseError(t,`loading ${e} of ${this.layer}`)}};var bp="layer.changeFlag",vp="layer.initialize",yp="layer.update",Sp="layer.finalize",xp="layer.matched",Al=2**24-1,wp=Object.freeze([]),Ep=fe(({oldViewport:r,viewport:e})=>r.equals(e)),Q=new Uint8ClampedArray(0),Mp={data:{type:"data",value:wp,async:!0},dataComparator:{type:"function",value:null,optional:!0},_dataDiff:{type:"function",value:r=>r&&r.__diff,optional:!0},dataTransform:{type:"function",value:null,optional:!0},onDataLoad:{type:"function",value:null,optional:!0},onError:{type:"function",value:null,optional:!0},fetch:{type:"function",value:(r,{propName:e,layer:t,loaders:i,loadOptions:o,signal:n})=>{let{resourceManager:s}=t.context;o=o||t.getLoadOptions(),i=i||t.props.loaders,n&&(o={...o,core:{...o?.core,fetch:{...o?.core?.fetch,signal:n}}});let a=s.contains(r);return!a&&!o&&(s.add({resourceId:r,data:Pt(r,i),persistent:!1}),a=!0),a?s.subscribe({resourceId:r,onChange:l=>t.internalState?.reloadAsyncProp(e,l),consumerId:t.id,requestId:e}):Pt(r,i,o)}},updateTriggers:{},visible:!0,pickable:!1,opacity:{type:"number",min:0,max:1,value:1},operation:"draw",onHover:{type:"function",value:null,optional:!0},onClick:{type:"function",value:null,optional:!0},onDragStart:{type:"function",value:null,optional:!0},onDrag:{type:"function",value:null,optional:!0},onDragEnd:{type:"function",value:null,optional:!0},coordinateSystem:"default",coordinateOrigin:{type:"array",value:[0,0,0],compare:!0},modelMatrix:{type:"array",value:null,compare:!0,optional:!0},wrapLongitude:!1,positionFormat:"XYZ",colorFormat:"RGBA",parameters:{type:"object",value:{},optional:!0,compare:2},loadOptions:{type:"object",value:null,optional:!0,ignore:!0},transitions:null,extensions:[],loaders:{type:"array",value:[],optional:!0,ignore:!0},getPolygonOffset:{type:"function",value:({layerIndex:r})=>[0,-r*100]},highlightedObjectIndex:null,autoHighlight:!1,highlightColor:{type:"accessor",value:[0,0,128,128]}},ki=class extends Kr{constructor(){super(...arguments),this.internalState=null,this.lifecycle=Re.NO_STATE,this.parent=null}static get componentName(){return Object.prototype.hasOwnProperty.call(this,"layerName")?this.layerName:""}get root(){let e=this;for(;e.parent;)e=e.parent;return e}toString(){return`${this.constructor.layerName||this.constructor.name}({id: '${this.props.id}'})`}project(e){N(this.internalState);let t=this.internalState.viewport||this.context.viewport,i=Xr(e,{viewport:t,modelMatrix:this.props.modelMatrix,coordinateOrigin:this.props.coordinateOrigin,coordinateSystem:this.props.coordinateSystem}),[o,n,s]=mt(i,t.pixelProjectionMatrix);return e.length===2?[o,n]:[o,n,s]}unproject(e){return N(this.internalState),(this.internalState.viewport||this.context.viewport).unproject(e)}projectPosition(e,t){N(this.internalState);let i=this.internalState.viewport||this.context.viewport;return xl(e,{viewport:i,modelMatrix:this.props.modelMatrix,coordinateOrigin:this.props.coordinateOrigin,coordinateSystem:this.props.coordinateSystem,...t})}get isComposite(){return!1}get isDrawable(){return!0}setState(e){this.setChangeFlags({stateChanged:!0}),Object.assign(this.state,e),this.setNeedsRedraw()}setNeedsRedraw(){this.internalState&&(this.internalState.needsRedraw=!0)}setNeedsUpdate(){this.internalState&&(this.context.layerManager.setNeedsUpdate(String(this)),this.internalState.needsUpdate=!0)}get isLoaded(){return this.internalState?!this.internalState.isAsyncPropLoading():!1}get wrapLongitude(){return this.props.wrapLongitude}isPickable(){return this.props.pickable&&this.props.visible}getModels(){let e=this.state;return e&&(e.models||e.model&&[e.model])||[]}setShaderModuleProps(...e){for(let t of this.getModels())t.shaderInputs.setProps(...e)}getAttributeManager(){return this.internalState&&this.internalState.attributeManager}getCurrentLayer(){return this.internalState&&this.internalState.layer}getLoadOptions(){return this.props.loadOptions}use64bitPositions(){let{coordinateSystem:e}=this.props;return e==="default"||e==="lnglat"||e==="cartesian"}onHover(e,t){return this.props.onHover&&this.props.onHover(e,t)||!1}onClick(e,t){return this.props.onClick&&this.props.onClick(e,t)||!1}nullPickingColor(){return[0,0,0]}encodePickingColor(e,t=[]){return t[0]=e+1&255,t[1]=e+1>>8&255,t[2]=e+1>>8>>8&255,t}decodePickingColor(e){N(e instanceof Uint8Array);let[t,i,o]=e;return t+i*256+o*65536-1}getNumInstances(){return Number.isFinite(this.props.numInstances)?this.props.numInstances:this.state&&this.state.numInstances!==void 0?this.state.numInstances:yl(this.props.data)}getStartIndices(){return this.props.startIndices?this.props.startIndices:this.state&&this.state.startIndices?this.state.startIndices:null}getBounds(){return this.getAttributeManager()?.getBounds(["positions","instancePositions"])}getShaders(e){e=vn(e,{disableWarnings:!0,modules:this.context.defaultShaderModules});for(let t of this.props.extensions)e=vn(e,t.getShaders.call(this,t));return e}shouldUpdateState(e){return e.changeFlags.propsOrDataChanged}updateState(e){let t=this.getAttributeManager(),{dataChanged:i}=e.changeFlags;if(i&&t)if(Array.isArray(i))for(let o of i)t.invalidateAll(o);else t.invalidateAll();if(t){let{props:o}=e,n=this.internalState.hasPickingBuffer,s=Number.isInteger(o.highlightedObjectIndex)||!!o.pickable||o.extensions.some(a=>a.getNeedsPickingBuffer.call(this,a));if(n!==s){this.internalState.hasPickingBuffer=s;let{pickingColors:a,instancePickingColors:l}=t.attributes,c=a||l;c&&(s&&c.constant&&(c.constant=!1,t.invalidate(c.id)),!c.value&&!s&&(c.constant=!0,c.value=[0,0,0]))}}}finalizeState(e){for(let i of this.getModels())i.destroy();let t=this.getAttributeManager();t&&t.finalize(),this.context&&this.context.resourceManager.unsubscribe({consumerId:this.id}),this.internalState&&(this.internalState.uniformTransitions.clear(),this.internalState.finalize())}draw(e){for(let t of this.getModels())t.draw(e.renderPass)}getPickingInfo({info:e,mode:t,sourceLayer:i}){let{index:o}=e;return o>=0&&Array.isArray(this.props.data)&&(e.object=this.props.data[o]),e}raiseError(e,t){t&&(e=new Error(`${t}: ${e.message}`,{cause:e})),this.props.onError?.(e)||this.context?.onError?.(e,this)}getNeedsRedraw(e={clearRedrawFlags:!1}){return this._getNeedsRedraw(e)}needsUpdate(){return this.internalState?this.internalState.needsUpdate||this.hasUniformTransition()||this.shouldUpdateState(this._getUpdateParams()):!1}hasUniformTransition(){return this.internalState?.uniformTransitions.active||!1}activateViewport(e){if(!this.internalState)return;let t=this.internalState.viewport;this.internalState.viewport=e,(!t||!Ep({oldViewport:t,viewport:e}))&&(this.setChangeFlags({viewportChanged:!0}),this.isComposite?this.needsUpdate()&&this.setNeedsUpdate():this._update())}invalidateAttribute(e="all"){let t=this.getAttributeManager();t&&(e==="all"?t.invalidateAll():t.invalidate(e))}updateAttributes(e){let t=!1;for(let i in e)e[i].layoutChanged()&&(t=!0);for(let i of this.getModels())this._setModelAttributes(i,e,t)}_updateAttributes(){let e=this.getAttributeManager();if(!e)return;let t=this.props,i=this.getNumInstances(),o=this.getStartIndices();e.update({data:t.data,numInstances:i,startIndices:o,props:t,transitions:t.transitions,buffers:t.data.attributes,context:this});let n=e.getChangedAttributes({clearChangedFlags:!0});this.updateAttributes(n)}_updateAttributeTransition(){let e=this.getAttributeManager();e&&e.updateTransition()}_updateUniformTransition(){let{uniformTransitions:e}=this.internalState;if(e.active){let t=e.update(),i=Object.create(this.props);for(let o in t)Object.defineProperty(i,o,{value:t[o]});return i}return this.props}calculateInstancePickingColors(e,{numInstances:t}){if(e.constant)return;let i=Math.floor(Q.length/4);this.internalState.usesPickingColorCache=!0;let o=t>0&&Q[0]===0;if(i<t||o){t>Al&&M.warn("Layer has too many data objects. Picking might not be able to distinguish all objects.")(),Q=se.allocate(Q,t,{size:4,copy:!0,maxCount:Math.max(t,Al)});let n=Math.floor(Q.length/4),s=[0,0,0],a=o?0:i;for(let l=a;l<n;l++)this.encodePickingColor(l,s),Q[l*4+0]=s[0],Q[l*4+1]=s[1],Q[l*4+2]=s[2],Q[l*4+3]=0}e.value=Q.subarray(0,t*4)}_setModelAttributes(e,t,i=!1){if(!Object.keys(t).length)return;if(i){let a=this.getAttributeManager();e.setBufferLayout(a.getBufferLayouts(e)),t=a.getAttributes()}let o=e.userData?.excludeAttributes||{},n={},s={};for(let a in t){if(o[a])continue;let l=t[a].getValue();for(let c in l){let f=l[c];f instanceof U?t[a].settings.isIndexed?e.setIndexBuffer(f):n[c]=f:f&&(s[c]=f)}}e.setAttributes(n),e.setConstantAttributes(s)}disablePickingIndex(e){let t=this.props.data;if(!("attributes"in t)){this._disablePickingIndex(e);return}let{pickingColors:i,instancePickingColors:o}=this.getAttributeManager().attributes,n=i||o,s=n&&t.attributes&&t.attributes[n.id];if(s&&s.value){let a=s.value,l=this.encodePickingColor(e);for(let c=0;c<t.length;c++){let f=n.getVertexOffset(c);a[f]===l[0]&&a[f+1]===l[1]&&a[f+2]===l[2]&&this._disablePickingIndex(c)}}else this._disablePickingIndex(e)}_disablePickingIndex(e){let{pickingColors:t,instancePickingColors:i}=this.getAttributeManager().attributes,o=t||i;if(!o)return;let n=o.getVertexOffset(e),s=o.getVertexOffset(e+1);o.buffer.write(new Uint8Array(s-n),n)}restorePickingColors(){let{pickingColors:e,instancePickingColors:t}=this.getAttributeManager().attributes,i=e||t;i&&(this.internalState.usesPickingColorCache&&i.value.buffer!==Q.buffer&&(i.value=Q.subarray(0,i.value.length)),i.updateSubBuffer({startOffset:0}))}_initialize(){N(!this.internalState),V(vp,this);let e=this._getAttributeManager();e&&e.addInstanced({instancePickingColors:{type:"uint8",size:4,noAlloc:!0,update:this.calculateInstancePickingColors}}),this.internalState=new Di({attributeManager:e,layer:this}),this._clearChangeFlags(),this.state={},Object.defineProperty(this.state,"attributeManager",{get:()=>(M.deprecated("layer.state.attributeManager","layer.getAttributeManager()")(),e)}),this.internalState.uniformTransitions=new Ii(this.context.timeline),this.internalState.onAsyncPropUpdated=this._onAsyncPropUpdated.bind(this),this.internalState.setAsyncProps(this.props),this.initializeState(this.context);for(let t of this.props.extensions)t.initializeState.call(this,this.context,t);this.setChangeFlags({dataChanged:"init",propsChanged:"init",viewportChanged:!0,extensionsChanged:!0}),this._update()}_transferState(e){V(xp,this,this===e);let{state:t,internalState:i}=e;this!==e&&(this.internalState=i,this.state=t,this.internalState.setAsyncProps(this.props),this._diffProps(this.props,this.internalState.getOldProps()))}_update(){let e=this.needsUpdate();if(V(yp,this,e),!e)return;this.context.stats.get("Layer updates").incrementCount();let t=this.props,i=this.context,o=this.internalState,n=i.viewport,s=this._updateUniformTransition();o.propsInTransition=s,i.viewport=o.viewport||n,this.props=s;try{let a=this._getUpdateParams(),l=this.getModels();if(i.device)this.updateState(a);else try{this.updateState(a)}catch{}for(let f of this.props.extensions)f.updateState.call(this,a,f);this.setNeedsRedraw(),this._updateAttributes();let c=this.getModels()[0]!==l[0];this._postUpdate(a,c)}finally{i.viewport=n,this.props=t,this._clearChangeFlags(),o.needsUpdate=!1,o.resetOldProps()}}_finalize(){V(Sp,this),this.finalizeState(this.context);for(let e of this.props.extensions)e.finalizeState.call(this,this.context,e)}_drawLayer({renderPass:e,shaderModuleProps:t=null,uniforms:i={},parameters:o={}}){this._updateAttributeTransition();let n=this.props,s=this.context;this.props=this.internalState.propsInTransition||n;try{t&&this.setShaderModuleProps(t);let{getPolygonOffset:a}=this.props,l=a&&a(i)||[0,0];s.device instanceof ji&&s.device.setParametersWebGL({polygonOffset:l});let c=s.device instanceof ji?null:Pp(o);if(Tp(this.getModels(),e,o,c),s.device instanceof ji)s.device.withParametersWebGL(o,()=>{let f={renderPass:e,shaderModuleProps:t,uniforms:i,parameters:o,context:s};for(let u of this.props.extensions)u.draw.call(this,f,u);this.draw(f)});else{c?.renderPassParameters&&e.setParameters(c.renderPassParameters);let f={renderPass:e,shaderModuleProps:t,uniforms:i,parameters:o,context:s};for(let u of this.props.extensions)u.draw.call(this,f,u);this.draw(f)}}finally{this.props=n}}getChangeFlags(){return this.internalState?.changeFlags}setChangeFlags(e){if(!this.internalState)return;let{changeFlags:t}=this.internalState;for(let o in e)if(e[o]){let n=!1;switch(o){case"dataChanged":let s=e[o],a=t[o];s&&Array.isArray(a)&&(t.dataChanged=Array.isArray(s)?a.concat(s):s,n=!0);default:t[o]||(t[o]=e[o],n=!0)}n&&V(bp,this,o,e)}let i=!!(t.dataChanged||t.updateTriggersChanged||t.propsChanged||t.extensionsChanged);t.propsOrDataChanged=i,t.somethingChanged=i||t.viewportChanged||t.stateChanged}_clearChangeFlags(){this.internalState.changeFlags={dataChanged:!1,propsChanged:!1,updateTriggersChanged:!1,viewportChanged:!1,stateChanged:!1,extensionsChanged:!1,propsOrDataChanged:!1,somethingChanged:!1}}_diffProps(e,t){let i=bl(e,t);if(i.updateTriggersChanged)for(let o in i.updateTriggersChanged)i.updateTriggersChanged[o]&&this.invalidateAttribute(o);if(i.transitionsChanged)for(let o in i.transitionsChanged)this.internalState.uniformTransitions.add(o,t[o],e[o],e.transitions?.[o]);return this.setChangeFlags(i)}validateProps(){_l(this.props)}updateAutoHighlight(e){this.props.autoHighlight&&!Number.isInteger(this.props.highlightedObjectIndex)&&this._updateAutoHighlight(e)}_updateAutoHighlight(e){let t={highlightedObjectColor:e.picked?e.color:null},{highlightColor:i}=this.props;e.picked&&typeof i=="function"&&(t.highlightColor=i(e)),this.setShaderModuleProps({picking:t}),this.setNeedsRedraw()}_getAttributeManager(){let e=this.context;return new Ci(e.device,{id:this.props.id,stats:e.stats,timeline:e.timeline})}_postUpdate(e,t){let{props:i,oldProps:o}=e,n=this.state.model;n?.isInstanced&&n.setInstanceCount(this.getNumInstances());let{autoHighlight:s,highlightedObjectIndex:a,highlightColor:l}=i;if(t||o.autoHighlight!==s||o.highlightedObjectIndex!==a||o.highlightColor!==l){let c={};Array.isArray(l)&&(c.highlightColor=l),(t||o.autoHighlight!==s||a!==o.highlightedObjectIndex)&&(c.highlightedObjectColor=Number.isFinite(a)&&a>=0?this.encodePickingColor(a):null),this.setShaderModuleProps({picking:c})}}_getUpdateParams(){return{props:this.props,oldProps:this.internalState.getOldProps(),context:this.context,changeFlags:this.internalState.changeFlags}}_getNeedsRedraw(e){if(!this.internalState)return!1;let t=!1;t=t||this.internalState.needsRedraw&&this.id;let i=this.getAttributeManager(),o=i?i.getNeedsRedraw(e):!1;if(t=t||o,t)for(let n of this.props.extensions)n.onNeedsRedraw.call(this,n);return this.internalState.needsRedraw=this.internalState.needsRedraw&&!e.clearRedrawFlags,t}_onAsyncPropUpdated(){this._diffProps(this.props,this.internalState.getOldProps()),this.setNeedsUpdate()}};ki.defaultProps=Mp;ki.layerName="Layer";var Mn=ki;function Pp(r){let{blendConstant:e,...t}=r;return e?{pipelineParameters:t,renderPassParameters:{blendConstant:e}}:{pipelineParameters:t}}function Tp(r,e,t,i){for(let o of r)o.device.type==="webgpu"?(Ap(o,e),o.setParameters({...o.parameters,...i?.pipelineParameters})):o.setParameters(t)}function Ap(r,e){let t=e.props.framebuffer||(e.framebuffer??null);if(!t)return;let i=t.colorAttachments.map(s=>s?.texture?.format??null),o=t.depthStencilAttachment?.texture?.format,n=r;(!Cp(n.props.colorAttachmentFormats,i)||n.props.depthStencilAttachmentFormat!==o)&&(n.props.colorAttachmentFormats=i,n.props.depthStencilAttachmentFormat=o,n._setPipelineNeedsUpdate("attachment formats"))}function Cp(r,e){if(r===e)return!0;if(!r||!e||r.length!==e.length)return!1;for(let t=0;t<r.length;t++)if(r[t]!==e[t])return!1;return!0}var Lp="compositeLayer.renderLayers",Jr=class extends Mn{get isComposite(){return!0}get isDrawable(){return!1}get isLoaded(){return super.isLoaded&&this.getSubLayers().every(e=>e.isLoaded)}getSubLayers(){return this.internalState&&this.internalState.subLayers||[]}initializeState(e){}setState(e){super.setState(e),this.setNeedsUpdate()}getPickingInfo({info:e}){let{object:t}=e;return t&&t.__source&&t.__source.parent&&t.__source.parent.id===this.id&&(e.object=t.__source.object,e.index=t.__source.index),e}filterSubLayer(e){return!0}shouldRenderSubLayer(e,t){return t&&t.length}getSubLayerClass(e,t){let{_subLayerProps:i}=this.props;return i&&i[e]&&i[e].type||t}getSubLayerRow(e,t,i){return e.__source={parent:this,object:t,index:i},e}getSubLayerAccessor(e){if(typeof e=="function"){let t={index:-1,data:this.props.data,target:[]};return(i,o)=>i&&i.__source?(t.index=i.__source.index,e(i.__source.object,t)):e(i,o)}return e}getSubLayerProps(e={}){let{opacity:t,pickable:i,visible:o,parameters:n,getPolygonOffset:s,highlightedObjectIndex:a,autoHighlight:l,highlightColor:c,coordinateSystem:f,coordinateOrigin:u,wrapLongitude:h,positionFormat:p,modelMatrix:d,extensions:g,fetch:b,operation:v,_subLayerProps:y}=this.props,_={id:"",updateTriggers:{},opacity:t,pickable:i,visible:o,parameters:n,getPolygonOffset:s,highlightedObjectIndex:a,autoHighlight:l,highlightColor:c,coordinateSystem:f,coordinateOrigin:u,wrapLongitude:h,positionFormat:p,modelMatrix:d,extensions:g,fetch:b,operation:v},S=y&&e.id&&y[e.id],P=S&&S.updateTriggers,x=e.id||"sublayer";if(S){let E=this.props[J],C=e.type?e.type._propTypes:{};for(let T in S){let A=C[T]||E[T];A&&A.type==="accessor"&&(S[T]=this.getSubLayerAccessor(S[T]))}}Object.assign(_,e,S),_.id=`${this.props.id}-${x}`,_.updateTriggers={all:this.props.updateTriggers?.all,...e.updateTriggers,...P};for(let E of g){let C=E.getSubLayerProps.call(this,E);C&&Object.assign(_,C,{updateTriggers:Object.assign(_.updateTriggers,C.updateTriggers)})}return _}_updateAutoHighlight(e){for(let t of this.getSubLayers())t.updateAutoHighlight(e)}_getAttributeManager(){return null}_postUpdate(e,t){let i=this.internalState.subLayers,o=!i||this.needsUpdate();if(o){let n=this.renderLayers();i=He(n,Boolean),this.internalState.subLayers=i}V(Lp,this,o,i);for(let n of i)n.parent=this}};Jr.layerName="CompositeLayer";var Rp=Jr;var Pn=Math.PI/180,Ip=180/Math.PI;function Cl(r,e=0){let t=Math.min(180,r)*Pn;return ve*2*Math.sin(t/2)*Math.pow(2,e)}function Ll(r,e=0){let t=r/Math.pow(2,e);return Math.asin(Math.min(1,t/ve/2))*2*Ip}var Tn=class extends ui{constructor(e){let{startPanPos:t,...i}=e;i.normalize=!1,super(i),t!==void 0&&(this._state.startPanPos=t)}panStart({pos:e}){let{latitude:t,longitude:i,zoom:o}=this.getViewportProps();return this._getUpdatedState({startPanLngLat:[i,t],startPanPos:e,startZoom:o})}pan({pos:e,startPos:t}){let i=this.getState(),o=i.startPanLngLat||this._unproject(t);if(!o)return this;let n=i.startZoom??this.getViewportProps().zoom,s=i.startPanPos||t,a=[o[0],o[1],n],c=this.makeViewport(this.getViewportProps()).panByPosition(a,e,s);return this._getUpdatedState(c)}panEnd(){return this._getUpdatedState({startPanLngLat:null,startPanPos:null,startZoom:null})}zoom({scale:e}){let i=(this.getState().startZoom||this.getViewportProps().zoom)+Math.log2(e);return this._getUpdatedState({zoom:i})}applyConstraints(e){let{longitude:t,latitude:i,maxBounds:o}=e;if(e.zoom=this._constrainZoom(e.zoom,e),(t<-180||t>180)&&(e.longitude=oi(t+180,360)-180),e.latitude=F(i,-$,$),o&&(e.longitude=F(e.longitude,o[0][0],o[1][0]),e.latitude=F(e.latitude,o[0][1],o[1][1])),o){let n=e.zoom-he(i),s=o[1][0]-o[0][0],a=o[1][1]-o[0][1];if(a>0&&a<$*2){let l=Math.min(Ll(e.height,n),a)/2;e.latitude=F(e.latitude,o[0][1]+l,o[1][1]-l)}if(s>0&&s<360){let l=Math.min(Ll(e.width/Math.cos(e.latitude*Pn),n),s)/2;e.longitude=F(e.longitude,o[0][0]+l,o[1][0]-l)}}return e.latitude!==i&&(e.zoom+=he(e.latitude)-he(i)),e}_constrainZoom(e,t){t||(t=this.getViewportProps());let{latitude:i,maxZoom:o,maxBounds:n}=t,{minZoom:s}=t,a=he(0),l=he(i)-a;if(n!==null&&t.width>0&&t.height>0){let f=n[0][1],u=n[1][1],h=Math.sign(f)===Math.sign(u)?Math.min(Math.abs(f),Math.abs(u)):0,p=Cl(n[1][0]-n[0][0])*Math.cos(h*Pn),d=Cl(n[1][1]-n[0][1]);p>0&&(s=Math.max(s,Math.log2(t.width/p)+a)),d>0&&(s=Math.max(s,Math.log2(t.height/d)+a)),s>o&&(s=o)}return F(e,s+l,o+l)}},Bi=class extends Ze{constructor(){super(...arguments),this.ControllerState=Tn,this.transition={transitionDuration:300,transitionInterpolator:new ye(["longitude","latitude","zoom"])},this.dragMode="pan"}setProps(e){super.setProps(e),this.dragRotate=!1,this.touchRotate=!1}};var Op={cullMode:"back"},Qr=class extends Ye{constructor(e={}){super({...e,parameters:{...Op,...e.parameters}})}getViewportType(e){return e.zoom>12?qe:ci}get ControllerType(){return Bi}};Qr.displayName="GlobeView";var Np=Qr;var Vi=class{static get componentName(){return Object.prototype.hasOwnProperty.call(this,"extensionName")?this.extensionName:""}constructor(e){e&&(this.opts=e)}equals(e){return this===e?!0:this.constructor===e.constructor&&B(this.opts,e.opts,1)}getShaders(e){return null}getSubLayerProps(e){let{defaultProps:t}=e.constructor,i={updateTriggers:{}};for(let o in t)if(o in this.props){let n=t[o],s=this.props[o];i[o]=s,n&&n.type==="accessor"&&(i.updateTriggers[o]=this.props.updateTriggers[o],typeof s=="function"&&(i[o]=this.getSubLayerAccessor(s)))}return i}initializeState(e,t){}updateState(e,t){}onNeedsRedraw(e){}getNeedsPickingBuffer(e){return!1}draw(e,t){}finalizeState(e,t){}};Vi.defaultProps={};Vi.extensionName="LayerExtension";var Up=Vi;var eo=class{constructor(e){this.indexStarts=[0],this.vertexStarts=[0],this.vertexCount=0,this.instanceCount=0;let{attributes:t={}}=e;this.typedArrayManager=se,this.attributes={},this._attributeDefs=t,this.opts=e,this.updateGeometry(e)}updateGeometry(e){Object.assign(this.opts,e);let{data:t,buffers:i={},getGeometry:o,geometryBuffer:n,positionFormat:s,dataChanged:a,normalize:l=!0}=this.opts;if(this.data=t,this.getGeometry=o,this.positionSize=n&&n.size||(s==="XY"?2:3),this.buffers=i,this.normalize=l,n&&(N(t.startIndices),this.getGeometry=this.getGeometryFromBuffer(n),l||(i.vertexPositions=n)),this.geometryBuffer=i.vertexPositions,Array.isArray(a))for(let c of a)this._rebuildGeometry(c);else this._rebuildGeometry()}updatePartialGeometry({startRow:e,endRow:t}){this._rebuildGeometry({startRow:e,endRow:t})}getGeometryFromBuffer(e){let t=e.value||e;return ArrayBuffer.isView(t)?jr(t,{size:this.positionSize,offset:e.offset,stride:e.stride,startIndices:this.data.startIndices}):null}_allocate(e,t){let{attributes:i,buffers:o,_attributeDefs:n,typedArrayManager:s}=this;for(let a in n)if(a in o)s.release(i[a]),i[a]=null;else{let l=n[a];l.copy=t,i[a]=s.allocate(i[a],e,l)}}_forEachGeometry(e,t,i){let{data:o,getGeometry:n}=this,{iterable:s,objectInfo:a}=xi(o,t,i);for(let l of s){a.index++;let c=n?n(l,a):null;e(c,a.index)}}_rebuildGeometry(e){if(!this.data)return;let{indexStarts:t,vertexStarts:i,instanceCount:o}=this,{data:n,geometryBuffer:s}=this,{startRow:a=0,endRow:l=1/0}=e||{},c={};if(e||(t=[0],i=[0]),this.normalize||!s)this._forEachGeometry((u,h)=>{let p=u&&this.normalizeGeometry(u);c[h]=p,i[h+1]=i[h]+(p?this.getGeometrySize(p):0)},a,l),o=i[i.length-1];else if(i=n.startIndices,o=i[n.length]||0,ArrayBuffer.isView(s))o=o||s.length/this.positionSize;else if(s instanceof U){let u=this.positionSize*4;o=o||s.byteLength/u}else if(s.buffer){let u=s.stride||this.positionSize*4;o=o||s.buffer.byteLength/u}else if(s.value){let u=s.value,h=s.stride/u.BYTES_PER_ELEMENT||this.positionSize;o=o||u.length/h}this._allocate(o,!!e),this.indexStarts=t,this.vertexStarts=i,this.instanceCount=o;let f={};this._forEachGeometry((u,h)=>{let p=c[h]||u;f.vertexStart=i[h],f.indexStart=t[h];let d=h<i.length-1?i[h+1]:o;f.geometrySize=d-i[h],f.geometryIndex=h,this.updateGeometryAttributes(p,f)},a,l),this.vertexCount=t[t.length-1]}};export{M as a,or as b,mf as c,hr as d,pr as e,Pf as f,da as g,fo as h,De as i,xa as j,K as k,Y as l,Qt as m,Ca as n,qe as o,ie as p,ut as q,qt as r,po as s,Ae as t,qo as u,Xo as v,He as w,B as x,N as y,ci as z,un as A,Ah as B,xi as C,Mn as D,Rp as E,Np as F,Up as G,eo as H};
