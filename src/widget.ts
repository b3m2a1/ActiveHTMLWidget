// Copyright (c) b3m2a1
// Distributed under the terms of the Modified BSD License.

import {
    unpack_models,
    reject,
    DOMWidgetModel,
    DOMWidgetView,
    WidgetModel,
    ViewList,
    ISerializers, WidgetView,
} from '@jupyter-widgets/base';

import {MODULE_NAME, MODULE_VERSION} from './version';

import {Widget, PanelLayout} from '@lumino/widgets';
import {ArrayExt} from '@lumino/algorithm';
import {
    Message, MessageLoop
} from '@lumino/messaging';
import {
    KernelMessage
} from '@jupyterlab/services';
import $, * as jquery from 'jquery';
import * as bootstrap from 'bootstrap';
// import {JupyterFrontEnd} from "@jupyterlab/application";

// // Import the CSS
// import '../css/widget.css';

namespace PatchedPhosphorWidget {
    export interface IOptions {
        view: DOMWidgetView;
    }
}

class LayoutManagerWidget extends Widget {
    constructor(options: Widget.IOptions & PatchedPhosphorWidget.IOptions) {
        let view = options.view;
        //@ts-ignore
        options.tag = view.tagName;
        super(options);
        this._view = view;
        this.layout = new PanelLayout({fitPolicy:'set-no-constraint'});
    }
    dispose() {
        if (this.isDisposed) {
            return;
        }
        super.dispose();
        if (this._view) {
            this._view.remove();
        }
        //@ts-ignore
        this._view = null;
    }
    processMessage(msg: Message) {
        super.processMessage(msg);
        this._view.processPhosphorMessage(msg);
    }
    get widgets(): ReadonlyArray<Widget> {
        return (this.layout as PanelLayout).widgets;
    }
    addWidget(widget: Widget): void {
        (this.layout as PanelLayout).addWidget(widget);
    }
    insertWidget(index: number, widget: Widget): void {
        (this.layout as PanelLayout).insertWidget(index, widget);
    }
    private _view: DOMWidgetView;
}

export class ActiveHTMLModel extends DOMWidgetModel {

    // _ihandlers: Record<string, [number, any]>;
    // constructor() {
    //     super();
    // }
    _is_ready=false;
    initialize(attributes: any, options: { model_id: string; comm?: any; widget_manager: any }) {
        super.initialize(attributes, options);
        // this._ihandlers= {};
        this.ready()
    }
    ready():Promise<ActiveHTMLModel> {
        if (!this._is_ready) {
            return this._updateHandlers().then(()=> {
                this.on('change:jsHandlers', this._updateHandlers, this);
                this._is_ready = true;
                return this
            })
        } else {
            return Promise.resolve(this)
        }
    }

    defaults() {
        return {
            ...super.defaults(),
            _model_name: ActiveHTMLModel.model_name,
            _model_module: ActiveHTMLModel.model_module,
            _model_module_version: ActiveHTMLModel.model_module_version,
            _view_name: ActiveHTMLModel.view_name,
            _view_module: ActiveHTMLModel.view_module,
            _view_module_version: ActiveHTMLModel.view_module_version,
            tagName: 'div',
            children: [],
            classList: [],
            innerHTML: "",
            textContent: "",
            _bodyType: "",
            _debugPrint:false,
            styleDict: {},
            elementAttributes: {},
            id: "",
            value: "",
            trackInput: false,
            continuousUpdate: true,
            eventPropertiesDict: {},
            defaultEventProperties: [
                "bubbles", "cancelable", "composed",
                "target", "timestamp", "type",
                "key", "repeat",
                "button", "buttons",
                "alKey", "shiftKey", "ctrlKey", "metaKey"
            ],
            jsHandlers: {},
            jsAPI: null,
            _ihandlers: {},
            onevents: {},
            exportData: {}
        };
    }

    static serializers: ISerializers = {
        ...DOMWidgetModel.serializers,
        // Add any extra serializers here
        //@ts-ignore
        children: {deserialize: unpack_models},
        //@ts-ignore
        elementAttributes: {deserialize: unpack_models},
        //@ts-ignore
        exportData: {deserialize: unpack_models},
        //@ts-ignore
        jsAPI: {deserialize: unpack_models}
    };

    static model_name = 'ActiveHTMLModel';
    static model_module = MODULE_NAME;
    static model_module_version = MODULE_VERSION;
    static view_name = 'ActiveHTMLView'; // Set to null if no view
    static view_module = MODULE_NAME; // Set to null if no view
    static view_module_version = MODULE_VERSION;

    _defineHandler(name:string, body:string) {
        // adapted from SO to define a named handler
        let lines = ['return function ' + name + '(event, widget, context) {' ];
        lines.push('\"use strict\";');
        lines.push(body);
        lines.push("}")
        return new Function(lines.join("\n"))();
    }
    _stringHash(str:string):number {
          // just needed a simple one so: https://stackoverflow.com/questions/7616461/generate-a-hash-from-string-in-javascript
          var hash = 0, i, chr;
          if (str.length === 0) return hash;
          for (i = 0; i < str.length; i++) {
            chr   = str.charCodeAt(i);
            hash  = ((hash << 5) - hash) + chr;
            hash |= 0; // Convert to 32bit integer
          }
          return hash;
    }
    _setHandlers(handlers:Record<string, string>) {
        let _ihandlers = this.get('_ihandlers');
        let debug = this.get('_debugPrint');
        for (let h in handlers) {
            if (h!="src"&&handlers.hasOwnProperty(h)) {
                let hash = this._stringHash(handlers[h]);
                if (
                    (!_ihandlers.hasOwnProperty(h)) ||
                    (_ihandlers[h][0] !== hash)
                ) {
                    if (debug) {
                        console.log('adding handler', h)
                    }
                    _ihandlers[h] = [hash, this._defineHandler(h, handlers[h])];
                }
            }
        }
    }
    _apiMod:string|null = null;
    static _needsAPILoad(curMod:string|null, handlers:Record<string, any>, _ihandlers:Record<string, any> ):boolean {
        return (
            handlers.hasOwnProperty("src") &&
            curMod !== handlers["src"] &&
            (!_ihandlers.hasOwnProperty("src")||_ihandlers["src"]!=handlers["src"])
            )
    }
    _apiLoader:Promise<Record<string, any>>|null = null;
    _updateHandlers(): Promise<Record<string, any>> {
        let handlers = this.get('jsHandlers') as Record<string, string>;
        let debug = this.get('_debugPrint');
        let _ihandlers = this.get('_ihandlers') as Record<string, any>;
        let imp = null;
        if (ActiveHTMLModel._needsAPILoad(this._apiMod, handlers, _ihandlers)) {
            if (debug) {
                console.log('loading API from source', handlers["src"]);
            }
            // Ugly TypeScript hack to keep the dynamic import semantics we need
            // for reliable loading
            imp = eval("import(\"" + handlers["src"] + "\")");
        }
        if (imp !== null) {
            this._apiLoader = imp.then(
                (mod: Record<string, any>) => {
                    for (let m in mod) {
                        if (mod[m] instanceof Function) {
                            _ihandlers[m] = [null, mod[m]];
                        }
                    }
                    this._apiMod = handlers["src"];
                    _ihandlers["src"] = handlers["src"];
                }
            ).then(() => {
                this._setHandlers(handlers);
                this._apiLoader = null;
                return _ihandlers
            })
        }
        if (this._apiLoader !== null && typeof this._apiLoader !== "undefined") {
            return this._apiLoader as Promise<Record<string, any>>;
        } else {
            this._setHandlers(handlers)
            return Promise.resolve(_ihandlers)
        }
    }

    _handle_comm_msg(msg: KernelMessage.ICommMsgMsg): Promise<void> {
        const data = msg.content.data as any;
        let method = data.method;

        // if (this.get("_debugPrint")) {
        //     console.log("Message In:", data.method);
        // }

        if (method === "trigger") {
            this.trigger(data.content['handle'], data.content, msg.buffers);
            return Promise.resolve();
        } else if (method === "call") {
            this.callHandler(data.content['handle'],
                this.dummyEvent(data.content['handle'], {content:data.content, buffers:msg.buffers})
            );
            return Promise.resolve();
        } else {
            return super._handle_comm_msg(msg);
        }
    }

    dummyEvent(name:string, ops:object={}):Event {
        return {
            target:this,
            type:name,
            stopPropagation: function (){},
            ...ops
        } as unknown as Event; // a hack only so we can use the same interface for custom events
    }
    callHandler(method:string, event:Event): Promise<any> {
        return ActiveHTMLModel.callModelHandler(method, event, this, this);
    }
    static callModelHandler(method: string, event: Event, model:WidgetModel, target:any): Promise<any> {
        let handlers = model.get('_ihandlers') as Record<string, any>;
        let fn: ((event:Event, widget:WidgetModel, context:object) => any)|null = null;

        if (handlers.hasOwnProperty(method)) {
            fn = handlers[method][1];
            if (fn !== null) {
                let val = fn.call(target, event, target, ActiveHTMLView.handlerContext);
                return Promise.resolve(val);
            } else {
                throw new Error("handler " + method + " is null");
            }
        } else {
            let api = model.get('jsAPI') as ActiveHTMLModel|null;
            if (api !== null) {
                return api.ready().then((api) => {
                    handlers = api.get('_ihandlers') as Record<string, any>
                    if (handlers.hasOwnProperty(method)) {
                        fn = handlers[method][1];
                    }
                    if (fn !== null) {
                        return fn.call(target, event, target, ActiveHTMLView.handlerContext);
                    }  else {
                        throw new Error("couldn't find API method " + method);
                    }
                })
            } else {
                throw new Error("couldn't find handler or API method " + method);
            }
        }
    }
}

export class ActiveHTMLView extends DOMWidgetView {

    // constructDict(listPair:any) {
    //     let res = {};
    //     let keys = listPair[0];
    //     let vals = listPair[1];
    //     for (let i = 0; i < keys.length; i++) {
    //         //@ts-ignore
    //         res[keys[i]] = vals[i];
    //     }
    //     return res;
    // }
    initialize(parameters: any): void {
        super.initialize(parameters);
        //@ts-ignore
        this.children_views = new ViewList(this.add_child_model, null, this);
        this.listenTo(this.model, 'change:children', this.updateBody);
        this.listenTo(this.model, 'change:innerHTML', this.updateBody);
        this.listenTo(this.model, 'change:textContent', this.updateBody);
        this.listenTo(this.model, 'change:styleDict', this.updateStyles);
        this.listenTo(this.model, 'change:classList', this.updateClassList);
        this.listenTo(this.model, 'change:value', this.updateValue);
        this.listenTo(this.model, 'change:elementAttributes', this.updateAttributes);
        this.listenTo(this.model, 'change:eventPropertiesDict', this.updateEvents);
        this._currentEvents = {};
        this._currentOnHandlers = {};
        this._currentClasses = new Set();
        this._currentStyles = new Set();
        this._initted = false;
    }

    // Manage CSS styles
    _currentStyles: Set<string>;
    removeStyles(): Promise<any> {
        let newStyles = this.model.get("styleDict") as Record<string, string>;
        let current = this._currentStyles;
        return ActiveHTMLView._each(
            current,
            (prop) => {
                if (!newStyles.hasOwnProperty(prop)) {
                    this.el.style.removeProperty(prop);
                    this._currentStyles.delete(prop);
                }
            }
        )
    }
    setLayout(layout: WidgetModel, oldLayout?: WidgetModel) {} // null override
    setStyle(style: WidgetModel, oldStyle?: WidgetModel) {} // null override
    setStyles(): Promise<any> {
        let elementStyles = this.model.get("styleDict") as Record<string, string>;
        let keys = Object.keys(elementStyles);
        if (keys.length === 0) {
            this._currentStyles.clear();
            this.el.removeAttribute('style');
            return ActiveHTMLView._defaultPromise();
        } else {
            if (this.model.get("_debugPrint")) {
                console.log(this.el, "Element Styles:", elementStyles);
            }
            return ActiveHTMLView._each(
                keys,
                (prop:string) => {
                    if (elementStyles.hasOwnProperty(prop)) {
                        // console.log(">>>", prop, elementStyles[prop], typeof prop);
                        this.el.style.setProperty(prop, elementStyles[prop]);
                        // console.log("<<<", prop, this.el.style.getPropertyValue(prop));
                        this._currentStyles.add(prop);
                    }
                }
            )
        }
    }
    updateStyles(): Promise<any> {
        return this.setStyles().then(
            ()=>this.removeStyles
        )
    }

    // Manage classes
    _currentClasses: Set<string>;
    setClasses(): Promise<any> {
        if (this.model.get("_debugPrint")) {
            console.log(this.el, "Element Classes:", this.model.get("classList"));
        }
        let classList = this.model.get("classList");
        return ActiveHTMLView._each(
            classList,
            (cls:string)=> {
            this.el.classList.add(cls);
            this._currentClasses.add(cls);
        })
    }
    removeClasses(): Promise<any> {
        if (this.model.get("_debugPrint")) {
            console.log(this.el, "Element Classes:", this.model.get("classList"));
        }
        let current = this._currentClasses;
        let classes = this.model.get("classList");
        return ActiveHTMLView._each(
            current,
            (cls:string)=> {
                if (!classes.includes(cls)) {
                    this.el.classList.remove(cls);
                    this._currentClasses.delete(cls);
                }
            })
    }
    updateClassList():Promise<any> {
        return this.setClasses().then(
            ()=>this.removeClasses
        )
    }

    //manage body of element (borrowed from ipywidgets.Box)
    _createElement(tagName: string) {
        this.pWidget = new LayoutManagerWidget({view: this});
        return this.pWidget.node;
    }
    _setElement(el: HTMLElement) {
        if (this.el || el !== this.pWidget.node) {
            // Boxes don't allow setting the element beyond the initial creation.
            throw new Error('Cannot reset the DOM element.');
        }
        this.el = this.pWidget.node;
        this.$el = $(this.pWidget.node);
    }
    update_children():Promise<any> {
        if (this.children_views !== null) {
            return this.children_views.update(this.model.get('children')).then((views: DOMWidgetView[]) => {
                // Notify all children that their sizes may have changed.
                views.forEach((view) => {
                    MessageLoop.postMessage(view.pWidget, Widget.ResizeMessage.UnknownSize);
                });
            });
        } else {
            return ActiveHTMLView._defaultPromise();
        }
    }
    add_child_model(model: WidgetModel) {
        // we insert a dummy element so the order is preserved when we add
        // the rendered content later.
        let dummy = new Widget();
        //@ts-ignore
        this.pWidget.addWidget(dummy);

        return this.create_child_view(model).then((view: DOMWidgetView) => {
            // replace the dummy widget with the new one.
            //@ts-ignore
            let i = ArrayExt.firstIndexOf(this.pWidget.widgets, dummy);
            //@ts-ignore
            this.pWidget.insertWidget(i, view.pWidget);
            dummy.dispose();
            return view;
        }).catch(reject('Could not add child view to HTMLElement', true));
    }
    children_views: ViewList<DOMWidgetView> | null;
    remove(): void {
        this.children_views = null;
        let onevents = this.model.get('onevents') as Record<string, object>;
        if (onevents.hasOwnProperty('remove')) {
            let oninit = onevents['remove'];
            // if (Object.keys(oninit).length > 0) {
            this.handleEvent(this.dummyEvent('remove'), 'remove', oninit);
            // }
        }
        super.remove();
    }

    updateBody(): Promise<any> {
        let children = this.model.get('children');
        let debug = this.model.get("_debugPrint");
        if (children.length > 0) {
            if (debug) { console.log(this.el, "Updating Children..."); }
            return this.update_children();
        } else {
            let html = this.model.get("innerHTML");
            if (html.length > 0) {
                if (debug) { console.log(this.el, "Updating HTML..."); }
                this.updateInnerHTML();
                    return ActiveHTMLView._defaultPromise();
            } else {
                let text = this.model.get("textContent");
                if (text.length > 0) {
                    if (debug) { console.log(this.el, "Updating Text..."); }
                    this.updateTextContent();
                    return ActiveHTMLView._defaultPromise();
                } else {
                    if (debug) { console.log(this.el, "Updating HTML..."); }
                    this.updateInnerHTML();
                    return ActiveHTMLView._defaultPromise();
                }
            }
        }
    }
    updateInnerHTML(): void {
        // let bodyType = this.model.get('_bodyType');
        // if (bodyType !== "html") {
        //   this.resetBody();
        // }
        let val = this.model.get("innerHTML");
        let cur = this.el.innerHTML;
        if (val !== cur) {
            this.el.innerHTML = val;
        }
        // if (bodyType !== "html") {
        //   this.model.set('_bodyType', "html");
        // }
    }
    updateTextContent(): void {
        // let bodyType = this.model.get('_bodyType');
        // if (bodyType !== "html") {
        //   this.resetBody(bodyType);
        // }
        let val = this.model.get("textContent");
        let cur = this.el.textContent;
        if (val !== cur) {
            this.el.textContent = val;
        }
        // if (bodyType !== "html") {
        //   this.model.set('_bodyType', "html");
        // }
    }

    getAttribute(attrName:string) {
        return this.model.get('elementAttributes')[attrName];
    }
    // Setting attributes (like id)
    updateAttribute(attrName: string): Promise<any> {
        let attrs = {} as Record<string, any>;
        attrs[attrName] = this.model.get(attrName);
        return this._updateAttribute(attrName, attrs);
    };
    updateAttributeFromQuery(attrName: string, queryName: string): void {
        let val = this.model.get(queryName);
        if (val === "") {
            this.el.removeAttribute(attrName);
        } else {
            this.el.setAttribute(attrName, val);
        }
    }
    _escapesMap:Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
      '/': '&#x2F;',
      '`': '&#x60;',
      '=': '&#x3D;'
    };
    _escapeHTML(html:string) {
        let parent = this;
        return String(html).replace(/[&<>"'`=\/]/g, function (s) {
            return parent._escapesMap[s];
          }
        )
    }
    _modelHTMLSetter(prop:string, val:WidgetView) {
        let parent = this;
        function setHTML():Promise<any> {
            let ud = val.update() as undefined|Promise<any>;
            if (ud !== undefined) {
                return ud.then(
                    () => {
                        let newHTML = val.el.outerHTML;
                        let oldHTML = parent.el.getAttribute(prop);
                        if (newHTML != oldHTML) {
                            parent.el.setAttribute(prop, newHTML);
                            return parent.notifyAttrUpdate(prop);
                        } else {
                            return ActiveHTMLView._defaultPromise();
                        }
                    }
                )
            } else {
                let newHTML = val.el.outerHTML;
                let oldHTML = parent.el.getAttribute(prop);
                if (newHTML != oldHTML) {
                    parent.el.setAttribute(prop, newHTML);
                    return parent.notifyAttrUpdate(prop);
                } else {
                    return ActiveHTMLView._defaultPromise();
                }
            }
        }
        return setHTML;
    }
    _attachWidgetAsAttr(prop:string, val:WidgetView):Promise<any> {
        let setter = this._modelHTMLSetter(prop, val);
        val.model.on("change", setter, val);
        let r = val.render();
        if (r !== undefined) {
            return r.then(() => {
                if (val.hasOwnProperty('renderChildren')) {
                    //@ts-ignore
                    return val.renderChildren().then(setter)
                } else {
                    return setter();
                }
            })
        } else if (val.hasOwnProperty('renderChildren')) {
            //@ts-ignore
            return val.renderChildren().then(setter)
        } else {
            return setter();
        }
    }
    _updateAttribute(prop:string, attrs:Record<string, any>):Promise<any> {
        let val = attrs[prop] as string|object;
        if (val === "") {
            if (this.el.hasAttribute(prop)) {
                this.el.removeAttribute(prop);
                return this.notifyAttrUpdate(prop);
            }
        }  else if (typeof val === 'string') {
            let cur = this.el.getAttribute(prop);
            if (cur !== val) {
                this.el.setAttribute(prop, val);
                return this.notifyAttrUpdate(prop);
            }
        } else if (val instanceof WidgetView) {
            return this._attachWidgetAsAttr(prop, val);
        } else if (val instanceof WidgetModel) {
            return this.create_child_view(val).then((view: DOMWidgetView) => {
                return this._attachWidgetAsAttr(prop, view);
            }).catch(reject('Could not add child view to HTMLElement', true));
        } else {
            this.el.setAttribute(prop, val.toString() + Object.keys(val).toString());
            return this.notifyAttrUpdate(prop);
        }
        return ActiveHTMLView._defaultPromise();
    }

    static async _each(arr: Iterable<any>, fn: (item: any) => any): Promise<any> {
        for (const item of arr) await fn(item)
    }
    static _defaultPromise(val = null) {
        return new Promise((resolve) => { resolve(val); });
    }
    updateAttributes():Promise<any> {
        let attrs = this.model.get('elementAttributes') as Record<string, any>;
        let debug = this.model.get("_debugPrint");
        if (debug) { console.log(this.el, "Element Properties:", attrs); }
        return ActiveHTMLView._each(Object.keys(attrs), (prop:string)=>this._updateAttribute(prop, attrs))
    }
    notifyAttrUpdate(prop:string):Promise<any> {
        let key = "view-change:"+prop;
        let onevents = this.model.get('onevents') as Record<string, object>;
        if (onevents.hasOwnProperty('remove')) {
            if (this.model.get('_debugPrint')) {
                console.log('notifying attr change:', key)
            }
            let props = onevents[key];
            this.handleEvent(this.dummyEvent(key), key, props);
            // }
        }
        return ActiveHTMLView._defaultPromise();
    }
    updateValue():Promise<any> {
        let el = this.el as HTMLInputElement;
        let debug = this.model.get("_debugPrint");
        if (el !== undefined) {
            let is_checkbox = el.getAttribute('type') === 'checkbox' || el.getAttribute('type') === 'radio';
            let multiple = el.getAttribute('multiple');
            if (is_checkbox) {
                let checked = el.checked;
                if (checked !== undefined) {
                    let newVal = this.model.get('value');
                    let checkVal = newVal.length > 0 && newVal != "false" && newVal != "0";
                    if (checkVal !== checked) {
                        if (debug) {
                            console.log(this.el, 'updating checked', checked, "->", checkVal);
                        }
                        el.checked = checkVal;
                    }
                }
            } else if (multiple) {
                let el = this.el as HTMLSelectElement;
                let opts = el.selectedOptions;
                if (opts !== undefined) {
                    let val = [];
                    for(let i = 0; i < opts.length; i++) {
                        let o = opts[i];
                        val.push(o.value);
                    }
                    let newValStr = this.model.get('value');
                    if (typeof newValStr === 'string') {
                        let testVal = val.join('&&');
                        if (newValStr !== testVal) {
                            if (debug) {
                                console.log(this.el, 'updating selection', testVal, "->", newValStr);
                            }
                            let splitVals = newValStr.split("&&");
                            for(let i = 0; i < el.options.length; i++) {
                                let o = el.options[i];
                                o.selected = (splitVals.indexOf(o.value) > -1);
                            }
                        }
                    }
                }
            } else {
                let val = el.value;
                if (val !== undefined) {
                    let newVal = this.model.get('value');
                    if (newVal !== val) {
                        if (debug) {
                            console.log(this.el, 'updating value', val, "->", newVal);
                        }
                        el.value = newVal;
                    }
                }
            }
        }
        return ActiveHTMLView._defaultPromise();
    }

    _currentEvents: Record<string, any>;
    _registerEvent(key:string, listeners:Record<string, object>):void {
        if (!this._currentEvents.hasOwnProperty(key)) {
            this._currentEvents[key] = [
                listeners[key],
                this.constructEventListener(key, listeners[key])
            ];
            this.el.addEventListener(key, this._currentEvents[key][1]);
        } else if (this._currentEvents[key][0] !== listeners[key]) {
            this.el.removeEventListener(key, this._currentEvents[key][1]);
            this._currentEvents[key] = [
                listeners[key],
                this.constructEventListener(key, listeners[key])
            ];
            this.el.addEventListener(key, this._currentEvents[key][1]);
        }
    }
    setEvents():Promise<any> {
        let listeners = this.model.get('eventPropertiesDict') as Record<string, string[]>;
        let debug = this.model.get("_debugPrint");
        if (debug) { console.log(this.el, "Adding Events:", listeners); }
        return ActiveHTMLView._each(
            Object.keys(listeners),
            (key)=> {
                if (listeners.hasOwnProperty(key)) {
                    this._registerEvent(key, listeners);
                }
            }
            )
    }
    removeEvents():Promise<any> {
        let newListeners = this.model.get('eventPropertiesDict') as Record<string, string[]>;
        let current = this._currentEvents;
        let debug = this.model.get("_debugPrint");
        return ActiveHTMLView._each(
            Object.keys(current),
            (prop) => {
                if (current.hasOwnProperty(prop)) {
                    if (!newListeners.hasOwnProperty(prop)) {
                        if (debug) {
                            console.log(this.el, "Removing Event:", prop);
                        }
                        this.el.removeEventListener(prop, this._currentEvents[prop][1]);
                        this._currentEvents.delete(prop);
                    }
                }
            }
        )
    }
    updateEvents():Promise<any> {
        return this.setEvents().then(
            ()=>this.removeEvents()
        )
    }

    _currentOnHandlers: Record<string, any>;
    _registerOnHandler(key:string, listeners:Record<string, object>):void {
        if (!this._currentOnHandlers.hasOwnProperty(key)) {
            this._currentOnHandlers[key] = [
                listeners[key],
                this.constructOnHandler(key, listeners[key])
            ];
            this.model.on(key, this._currentOnHandlers[key][1], this);
        } else if (this._currentOnHandlers[key][0] !== listeners[key]) {
            this.model.off(key, this._currentOnHandlers[key][1], this);
            this._currentOnHandlers[key] = [
                listeners[key],
                this.constructOnHandler(key, listeners[key])
            ];
            this.model.on(key, this._currentOnHandlers[key][1], this);
        }
    }
    setOnHandlers():Promise<any> {
        let listeners = this.model.get('onevents') as Record<string, object>;
        let debug = this.model.get("_debugPrint");
        if (debug) { console.log(this.el, "Adding On Handlers:", listeners); }
        return ActiveHTMLView._each(
            Object.keys(listeners),
            (key)=> {
                if (listeners.hasOwnProperty(key)) {
                    return this._registerOnHandler(key, listeners);
                }
            }
        )
    }
    removeOnHandlers(): Promise<any> {
        let newListeners = this.model.get('onevents') as Record<string, string[]>;
        let current = this._currentOnHandlers;
        let debug = this.model.get("_debugPrint");
        return ActiveHTMLView._each(
            Object.keys(current),
            (prop) => {
                if (current.hasOwnProperty(prop)) {
                    if (!newListeners.hasOwnProperty(prop)) {
                        if (debug) {
                            console.log(this.el, "Removing On Handler:", prop);
                        }
                        this.model.off(prop, current[prop][1], this);
                        current.delete(prop);
                    }
                }
            }
        )
    }
    updateOnHandlers():Promise<any> {
        return this.setOnHandlers().then(
            ()=>this.removeOnHandlers()
        )
    }

    _initted: boolean;
    _calloninit():void {
        if (!this._initted) {
            let onevents = this.model.get('onevents') as Record<string, object>;
            if (onevents.hasOwnProperty('initialize')) {
                let oninit = onevents['initialize'];
                if (Object.keys(oninit).length > 0) {
                    this.handleEvent(this.dummyEvent('initialize'), 'initialize', oninit);
                }
            }
        }
        this._initted = true;
    }
    render(): Promise<any> {
        let r = super.render();
        if (r !== undefined) {
            return r.then(
                (v: WidgetView) => {
                    this.el.classList.remove('lm-Widget', 'p-Widget')
                    return this.update().then(() => this._calloninit)
                }
            )
        } else {
             this.el.classList.remove('lm-Widget', 'p-Widget');
             return this.update().then((v) => {this._calloninit(); return v});
        }
    }
    renderChildren(): Promise<any> {
        if (this.children_views !== null) {
            return this.children_views.update([]).then(
                (views) => ActiveHTMLView._each(
                    views,
                    (v: WidgetView) => {
                        if (v.hasOwnProperty('renderChildren')) {
                            //@ts-ignore
                            return v.renderChildren();
                        } else {
                            v.render();
                        }
                    }
                )
            )
        } else {
            return ActiveHTMLView._defaultPromise();
        }
    }

    update(): Promise<any> {
        return this.updateAttribute('id').then(
            () => this.updateClassList().then(
            () => this.setStyles().then(
            () => this.updateBody().then(
            () => this.updateAttributes().then(
            () => this.setEvents().then(
            () => this.setOnHandlers().then(
            () => this.updateValue().then(
            () => {return this;}
            ))))))))
        }


    // @ts-ignore
    get tagName() {
        // We can't make this an attribute with a default value
        // since it would be set after it is needed in the
        // constructor.
        return this.model.get('tagName');
    }
    // Adapted from the "TextView" from the core package
    events() {
        let events:Record<string, any> = {};
        if (this.model.get('trackInput')) {
            // let tagName = this.model.get('tagName');
            let key = 'keydown';// '.concat(tagName);
            //@ts-ignore
            events[key] = 'handleKeyDown';
            key = 'keypress';// '.concat(tagName);
            //@ts-ignore
            events[key] = 'handleKeypress';
            key = 'input';// '.concat(tagName);
            //@ts-ignore
            events[key] = 'handleChanging';
            key = 'change';// '.concat(tagName);
            //@ts-ignore
            events[key] = 'handleChanged';
        }
        return events;
    }
    handleKeyDown(e: Event) {
        e.stopPropagation();
    }
    handleKeypress(e: KeyboardEvent) {
        e.stopPropagation();
    }
    handleChanging(e: Event) {
        if (this.model.get('continuousUpdate')) {
            this.handleChanged(e);
        }
    }
    handleChanged(e: Event) {
        let target = e.target as HTMLInputElement;
        let el = this.el;
        let is_checkbox = el.getAttribute('type') === 'checkbox' || el.getAttribute('type') === 'radio';
        let multiple = el.getAttribute('multiple');
        if (is_checkbox) {
            let checked = target.checked;
            if (checked !== undefined) {
                this.model.set('value', checked ? "true" : "false", {updated_view: this});
                this.touch();
            }
        } else if (multiple) {
            let el = this.el as HTMLSelectElement;
            let opts = el.selectedOptions;
            if (opts !== undefined) {
                let val = [];
                for(let i = 0; i < opts.length; i++) {
                    let o = opts[i];
                    val.push(o.value);
                }
                let newVal = val.join('&&');
                this.model.set('value', newVal, {updated_view: this});
                this.touch();
            }
        } else {
            let val = target.value;
            if (val !== undefined) {
                this.model.set('value', val, {updated_view: this});
                this.touch();
            }
        }
    }

    setData(key:string, value:any) {
        let data = this.model.get('exportData') as Record<string, any>;
        data[key] = value;
        this.model.set('exportData', {}, {updated_view:this}); // force a state change
        this.model.set('exportData', data, {updated_view:this});
        this.touch()
    }
    getData(key:string, value:any) {
        let data = this.model.get('exportData') as Record<string, any>;
        return data[key];
    }
    static handlerContext = {
        'bootstrap': bootstrap,
        "$": $,
        "jquery": jquery,
        // "JupyterFrontEnd": JupyterFrontEnd
    };
    handleEvent(e:Event, eventName:string, propData:Record<string, any>|string[]|string) {
        let props:string[];
        let method = "";
        let send = true;
        if (Array.isArray(propData)) {
            props = propData;
        } else if (propData === undefined || propData === null) {
            props = this.model.get('defaultEventProperties');
        } else if (typeof propData === 'string') {
            method = propData;
            props = [];
        } else {
            method = propData['method'];
            if (method === undefined || method === null) {
                method = "";
            } else {
                send = propData.hasOwnProperty('notify') && propData['notify'] === true;
            }
            if (propData.hasOwnProperty('fields')) {
                props = propData['fields'];
            } else {
                props = this.model.get('defaultEventProperties');
            }
            let prop = propData['propagate'] !== true;
            if (prop) {
                e.stopPropagation();
            }
        }
        let debug = this.model.get('_debugPrint');
        if (debug) {
            console.log(this.el, "Handling event:", eventName, propData);
            if (method !== "") {
                console.log(this.el, "calling handler", method);
            }
        }
        // console.log("|", eventName, props);
        if (method !== "") {
            this.callHandler(method, e);
        }
        if (send) {
            this.sendEventMessage(e, this.constructEventMessage(e, props, eventName));
        }
    }
    callHandler(method:string, event:Event):Promise<any> {
        return ActiveHTMLModel.callModelHandler(method, event, this.model, this);
    }
    dummyEvent(name:string, ops:object={}):Event {
        return {
            target:this.el,
            type:name,
            stopPropagation: function (){},
            ...ops
        } as unknown as Event; // a hack only so we can use the same interface for custom events
    }
    constructEventListener(eventName:string, propData:object|string[]|string) {
        let parent = this;
        return function (e:Event) {
            parent.handleEvent(e, eventName, propData);
        };
    }
    constructOnHandler(eventName:string, propData:object|string[]|string) {
        let listener = this.constructEventListener(eventName, propData);
        let event = this.dummyEvent(eventName);
        return function (msg:object) {
            return listener({...msg, ...event});
        }
    }
    constructEventMessage(e: Event, props?:string[], eventName?:string) {
        if (props === undefined || props === null) {
            props = this.model.get('defaultEventProperties');
        }
        if (props === undefined) {
            props = ['target'];
        }
        let eventMessage:Record<string, any> = {};
        if (eventName !== undefined) {
            eventMessage['eventName'] = eventName;
        }
        for (let p of props) {
            // @ts-ignore
            let val = e[p];
            if (p === "target") {
                val = {};
                let t = e.target as HTMLElement;
                val['tag'] = t.tagName;
                val['innerHTML'] = t.innerHTML;
                for (let p of t.getAttributeNames()) {
                    val[p] = t.getAttribute(p);
                }
            }
            eventMessage[p] = val;
        }
        return eventMessage;
    }
    sendEventMessage(e: Event, message?:Record<string, any>) {
        if (message === undefined) {
            message = this.constructEventMessage(e);
        }
        let debug = this.model.get('_debugPrint');
        if (debug) {
            console.log(this.el, "Sending message:", message)
        }
        this.send(message);
    }
}
