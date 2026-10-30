// Copyright (c) b3m2a1
// Distributed under the terms of the Modified BSD License.

import {
    unpack_models,
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
        const view = options.view;
        super({...options, tag: view.tagName} as Widget.IOptions);
        this._view = view;
        this.layout = new PanelLayout({fitPolicy:'set-no-constraint'});
    }
    dispose() {
        if (this.isDisposed) {
            return;
        }
        const view = this._view;
        this._view = null;
        super.dispose();
        if (view) view.remove();
    }
    processMessage(msg: Message) {
        super.processMessage(msg);
        if (!this._view) return;
        if (typeof (this._view as any).processLuminoMessage === 'function') (this._view as any).processLuminoMessage(msg);
        else (this._view as any).processPhosphorMessage(msg);
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
    private _view: DOMWidgetView | null;
}

export class ActiveHTMLModel extends DOMWidgetModel {

    // _ihandlers: Record<string, [number, any]>;
    // constructor() {
    //     super();
    // }
    _is_ready: boolean;
    _readyPromise: Promise<ActiveHTMLModel> | null;
    _handlerVersion: number;
    _activeHTMLClosed: boolean;
    _moduleHandlers: Record<string, any>;
    _moduleLoads: Map<string, Promise<Record<string, any>>>;
    initialize(attributes: any, options: { model_id: string; comm?: any; widget_manager: any }) {
        super.initialize(attributes, options);
        this._is_ready = false;
        this._readyPromise = null;
        this._handlerVersion = 0;
        this._activeHTMLClosed = false;
        this._moduleHandlers = Object.create(null);
        this._moduleLoads = new Map();
        this._apiLoader = null;
        this._apiMod = null;
        this.listenTo(this, 'change:jsHandlers', () => {
            this._updateHandlers().catch(error => this.trigger('handler:error', error));
        });
        this.ready().catch(error => this.trigger('handler:error', error));
    }
    ready(): Promise<ActiveHTMLModel> {
        if (this._activeHTMLClosed) return Promise.reject(new Error('Widget model is closed'));
        if (this._apiLoader) return this._apiLoader.then(() => this);
        if (this._is_ready) return Promise.resolve(this);
        if (!this._readyPromise) {
            this._readyPromise = this._updateHandlers().then(() => {
                this._is_ready = true;
                return this;
            });
        }
        return this._readyPromise;
    }
    _closePromise: Promise<void> | null;
    close(comm_closed = false): Promise<void> {
        if (this._activeHTMLClosed) return this._closePromise || Promise.resolve();
        this._activeHTMLClosed = true;
        this._handlerVersion++;
        this.stopListening();
        this._moduleLoads.clear();
        this._apiLoader = null;
        this._readyPromise = null;
        const views = Object.values(this.views || {});
        const closing = super.close(comm_closed).then(async () => {
            await Promise.all(views.map(async pending => {
                const view = await pending as ActiveHTMLView;
                await view._removalPromise;
            }));
        });
        const clear = () => {
            this._moduleHandlers = Object.create(null);
            this.set('_ihandlers', Object.create(null), {silent: true});
        };
        this._closePromise = closing.then(clear, error => { clear(); throw error; });
        return this._closePromise;
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
            unsyncedProperties: [],
            eventTargetMode: 'compact',
            eventTargetFields: ['id', 'name', 'type', 'value', 'checked'],
            eventThrottleMs: 0,
            coalescedEvents: ['pointermove', 'mousemove', 'input', 'wheel'],
            elementAttributes: {},
            id: "",
            value: "",
            trackInput: false,
            continuousUpdate: true,
            eventPropertiesDict: {},
            defaultEventProperties: [
                "bubbles", "cancelable", "composed",
                "target", "timeStamp", "type",
                "key", "repeat",
                "button", "buttons",
                "altKey", "shiftKey", "ctrlKey", "metaKey"
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

    _defineHandler(name: string, body: string) {
        // Names are metadata, not interpolated executable source.
        const fn = new Function('event', 'widget', 'context', '\"use strict\";\n' + body);
        Object.defineProperty(fn, 'name', {value: name, configurable: true});
        return fn;
    }
    _setHandlers(handlers: Record<string, string>) {
        const previous = this.get('_ihandlers') || Object.create(null);
        const next = Object.assign(Object.create(null), this._moduleHandlers);
        for (const name of Object.keys(handlers)) {
            if (name === 'src') continue;
            const body = handlers[name];
            if (typeof body !== 'string') throw new TypeError('JavaScript handlers must be strings');
            // Exact source comparison avoids 32-bit hash collisions and removes
            // deleted handlers instead of accumulating stale executable closures.
            next[name] = previous[name] && previous[name][0] === body
                ? previous[name] : [body, this._defineHandler(name, body)];
        }
        this.set('_ihandlers', next, {silent: true});
        return next;
    }
    _apiMod: string | null;
    _apiLoader: Promise<Record<string, any>> | null;
    static _importModule(specifier: string): Promise<Record<string, any>> {
        // Keep native dynamic import through the CommonJS build, quoting the
        // specifier as data. Authorization of imports is a separate policy.
        return eval('import(' + JSON.stringify(specifier) + ')');
    }
    _updateHandlers(): Promise<Record<string, any>> {
        const handlers = {...this.get('jsHandlers')} as Record<string, string>;
        const version = ++this._handlerVersion;
        const source = handlers.src || null;
        let imported: Promise<Record<string, any>>;
        if (source && source !== this._apiMod) {
            if (!this._moduleLoads.has(source)) {
                const pending = ActiveHTMLModel._importModule(source);
                this._moduleLoads.set(source, pending);
                pending.catch(() => { if (this._moduleLoads.get(source) === pending) this._moduleLoads.delete(source); });
            }
            imported = this._moduleLoads.get(source)!;
        } else {
            imported = Promise.resolve(null as any);
        }
        const pending = imported.then(module => {
            if (this._activeHTMLClosed || version !== this._handlerVersion) return this.get('_ihandlers');
            if (source !== this._apiMod) {
                this._moduleHandlers = Object.create(null);
                if (module) for (const name of Object.keys(module)) {
                    if (typeof module[name] === 'function') this._moduleHandlers[name] = [null, module[name]];
                }
                this._apiMod = source;
            }
            for (const name of this._moduleLoads.keys()) if (name !== source) this._moduleLoads.delete(name);
            return this._setHandlers(handlers);
        });
        this._apiLoader = pending;
        const clear = () => { if (this._apiLoader === pending) this._apiLoader = null; };
        pending.then(clear, clear);
        return pending;
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
            return this.callHandler(data.content['handle'],
                this.dummyEvent(data.content['handle'], {content:data.content, buffers:msg.buffers})
            ).then(() => undefined);
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
    static callModelHandler(method: string, event: Event, model: WidgetModel, target: any): Promise<any> {
        const teardown = event.type === 'remove';
        const dispatch = (source: ActiveHTMLModel, allowAPI: boolean): Promise<any> => {
            if (!teardown && (source._activeHTMLClosed || !source._is_ready || source._apiLoader)) {
                return source.ready().then(() => dispatch(source, allowAPI));
            }
            const handlers = source.get('_ihandlers') || Object.create(null);
            if (Object.prototype.hasOwnProperty.call(handlers, method)) {
                try {
                    // Ready browser handlers run in the DOM event stack, so
                    // preventDefault/stopPropagation remain synchronous.
                    return Promise.resolve(handlers[method][1].call(target, event, target, ActiveHTMLView.handlerContext));
                } catch (error) { return Promise.reject(error); }
            }
            const api = allowAPI && source.get('jsAPI') as ActiveHTMLModel | null;
            if (api) return dispatch(api, false);
            return Promise.reject(new Error("couldn't find handler or API method " + method));
        };
        return dispatch(model as ActiveHTMLModel, true);
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
        this._removalPromise = Promise.resolve();
        this._activeHTMLRemoved = false;
        this._attributeBindings = new Map();
        this._attributeVersions = new Map();
        this._managedAttributes = new Set();
        this._pendingEvents = new Map();
        this._eventTimer = null;
        this._bodyVersion = 0;
        this._bodyUpdate = Promise.resolve();
        this._pendingAttributeViews = new Map();
        this.listenTo(this.model, 'change:onevents', this.updateOnHandlers);
        this.listenTo(this.model, 'change:id', () => this.updateAttribute('id'));
        this.listenTo(this.model, 'change:trackInput', () => this.delegateEvents());
    }

    _activeHTMLRemoved: boolean;
    _attributeBindings: Map<string, {source: any; view: WidgetView; setter: () => Promise<any>; owned: boolean}>;
    _attributeVersions: Map<string, number>;
    _managedAttributes: Set<string>;
    _pendingEvents: Map<string, Record<string, any>>;
    _eventTimer: ReturnType<typeof setTimeout> | null;
    _removalPromise: Promise<any>;
    _bodyVersion: number;
    _bodyUpdate: Promise<any>;
    _pendingAttributeViews: Map<string, {source: any; promise: Promise<any>}>;

    // Manage CSS styles
    _currentStyles: Set<string>;
    removeStyles(): Promise<any> {
        let newStyles = this.model.get("styleDict") as Record<string, string>;
        let current = this._currentStyles;
        return ActiveHTMLView._each(
            current,
            (prop) => {
                if (!newStyles.hasOwnProperty(prop) && !this._unsynced().includes(prop)) {
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
            return this.removeStyles();
        } else {
            if (this.model.get("_debugPrint")) {
                console.log(this.el, "Element Styles:", elementStyles);
            }
            return ActiveHTMLView._each(
                keys,
                (prop:string) => {
                    if (elementStyles.hasOwnProperty(prop) && !this._unsynced().includes(prop)) {
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
            ()=>this.removeStyles()
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
            ()=>this.removeClasses()
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
                if (!this._activeHTMLRemoved) views.forEach(view => {
                    if (!view.pWidget.isDisposed) MessageLoop.postMessage(view.pWidget, Widget.ResizeMessage.UnknownSize);
                });
                return views;
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
            // A child may finish loading after its parent has been removed.
            const i = this._activeHTMLRemoved || this.pWidget.isDisposed ? -1
                : ArrayExt.firstIndexOf((this.pWidget as any).widgets, dummy);
            if (this._activeHTMLRemoved || dummy.isDisposed || i < 0) {
                view.remove();
            } else {
                (this.pWidget as any).insertWidget(i, view.pWidget);
            }
            dummy.dispose();
            return view;
        }).catch(error => { dummy.dispose(); throw error; });
    }
    children_views: ViewList<DOMWidgetView> | null;
    remove(): void {
        if (this._activeHTMLRemoved) return;
        this._activeHTMLRemoved = true;
        this._bodyVersion++;
        if (this._eventTimer !== null) clearTimeout(this._eventTimer);
        this._eventTimer = null;
        this._pendingEvents.clear();
        for (const [name, record] of Object.entries(this._currentEvents)) this.el.removeEventListener(name, record[1]);
        for (const [name, record] of Object.entries(this._currentOnHandlers)) this.model.off(name, record[1], this);
        this._currentEvents = {};
        this._currentOnHandlers = {};
        for (const name of Array.from(this._attributeVersions.keys())) this._releaseAttribute(name);
        this._pendingAttributeViews.clear();
        this._attributeVersions.clear();
        this.stopListening();
        const children = this.children_views;
        this.children_views = null;
        if (children) children.remove().catch(error => this.model.trigger('view:error', error));
        try {
            const handlers = this.model.get('onevents') || {};
            if (Object.prototype.hasOwnProperty.call(handlers, 'remove')) {
                this._removalPromise = this.handleEvent(this.dummyEvent('remove'), 'remove', handlers.remove);
            }
        } finally { super.remove(); }
    }

    updateBody(): Promise<any> {
        const version = ++this._bodyVersion;
        const pending = this._bodyUpdate.catch(() => undefined).then(async () => {
            if (this._activeHTMLRemoved || !this.children_views || version !== this._bodyVersion) return;
            if (this.model.get('children').length) {
                await this.update_children();
            } else {
                await this.children_views.remove();
                if (this._activeHTMLRemoved || version !== this._bodyVersion) return;
                if (this.model.get('innerHTML').length) this.updateInnerHTML();
                else if (this.model.get('textContent').length) this.updateTextContent();
                else this.updateInnerHTML();
            }
        });
        this._bodyUpdate = pending;
        return pending;
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
    _modelHTMLSetter(prop: string, view: WidgetView) {
        return async () => {
            if (this._activeHTMLRemoved || this._attributeBindings.get(prop)?.view !== view) return;
            await view.update();
            if (this._activeHTMLRemoved || this._attributeBindings.get(prop)?.view !== view) return;
            const html = view.el.outerHTML;
            if (html !== this.el.getAttribute(prop)) {
                this.el.setAttribute(prop, html);
                await this.notifyAttrUpdate(prop);
            }
        };
    }
    _releaseAttribute(prop: string): number {
        const version = (this._attributeVersions.get(prop) || 0) + 1;
        this._attributeVersions.set(prop, version);
        this._pendingAttributeViews.delete(prop);
        const record = this._attributeBindings.get(prop);
        if (record) {
            this.stopListening(record.view.model, 'change', record.setter);
            if (record.owned) record.view.remove();
            this._attributeBindings.delete(prop);
        }
        return version;
    }
    _attachWidgetAsAttr(prop: string, view: WidgetView, source: any = view, owned = false, version?: number): Promise<any> {
        if (this._activeHTMLRemoved || (version !== undefined && version !== this._attributeVersions.get(prop))) {
            if (owned) view.remove();
            return Promise.resolve();
        }
        const setter = this._modelHTMLSetter(prop, view);
        this._attributeBindings.set(prop, {source, view, setter, owned});
        this.listenTo(view.model, 'change', setter);
        return setter();
    }
    _updateAttribute(prop: string, attrs: Record<string, any>): Promise<any> {
        if (this._activeHTMLRemoved) return Promise.resolve();
        const val = attrs[prop];
        const loading = this._pendingAttributeViews.get(prop);
        if (loading && loading.source === val) return loading.promise;
        const previous = this._attributeBindings.get(prop);
        if (previous && previous.source === val) return previous.setter();
        const version = this._releaseAttribute(prop);
        if (val == null || val === '' || val === false) {
            if (this.el.hasAttribute(prop)) { this.el.removeAttribute(prop); return this.notifyAttrUpdate(prop); }
        } else if (val instanceof WidgetView) {
            return this._attachWidgetAsAttr(prop, val, val, false, version);
        } else if (val instanceof WidgetModel) {
            const promise = this.create_child_view(val).then(view => this._attachWidgetAsAttr(prop, view, val, true, version));
            const record = {source: val, promise};
            this._pendingAttributeViews.set(prop, record);
            const clear = () => { if (this._pendingAttributeViews.get(prop) === record) this._pendingAttributeViews.delete(prop); };
            promise.then(clear, clear);
            return promise;
        } else {
            const text = val === true ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val);
            if (this.el.getAttribute(prop) !== text) { this.el.setAttribute(prop, text); return this.notifyAttrUpdate(prop); }
        }
        return Promise.resolve();
    }
    _unsynced(): string[] {
        return [...(this.model.get('unsyncedProperties') || []), ...(this.model.get('unsyncedProps') || [])];
    }


    static async _each(arr: Iterable<any>, fn: (item: any) => any): Promise<any> {
        for (const item of arr) await fn(item)
    }
    static _defaultPromise(val = null) {
        return new Promise((resolve) => { resolve(val); });
    }
    async updateAttributes(): Promise<any> {
        if (this._activeHTMLRemoved) return;
        const attrs = this.model.get('elementAttributes') as Record<string, any>;
        const unsynced = this._unsynced();
        for (const prop of Array.from(this._managedAttributes)) {
            if (!Object.prototype.hasOwnProperty.call(attrs, prop) && !unsynced.includes(prop)) {
                this._releaseAttribute(prop);
                this.el.removeAttribute(prop);
                this._managedAttributes.delete(prop);
            }
        }
        for (const prop of Object.keys(attrs)) if (!unsynced.includes(prop)) {
            this._managedAttributes.add(prop);
            await this._updateAttribute(prop, attrs);
        }
    }

    notifyAttrUpdate(prop:string):Promise<any> {
        let key = "view-change:"+prop;
        let onevents = this.model.get('onevents') as Record<string, object>;
        if (onevents.hasOwnProperty(key)) {
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
                        this.el.removeEventListener(prop, current[prop][1]);
                        delete current[prop];
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
                        delete current[prop];
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
        if (!this._initted && !this._activeHTMLRemoved) {
            let onevents = this.model.get('onevents') as Record<string, object>;
            if (onevents.hasOwnProperty('initialize')) {
                let oninit = onevents['initialize'];
                if (oninit !== undefined) {
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
                    return this.update().then(() => { this._calloninit(); return this; })
                }
            )
        } else {
             this.el.classList.remove('lm-Widget', 'p-Widget');
             return this.update().then((v) => {this._calloninit(); return v});
        }
    }
    async renderChildren(): Promise<any> {
        if (this._activeHTMLRemoved || !this.children_views) return;
        await this.updateBody();
        const views = this.children_views ? await Promise.all(this.children_views.views) : [];
        if (this._activeHTMLRemoved) return;
        for (const view of views || []) {
            if (typeof (view as any).renderChildren === 'function') await (view as any).renderChildren();
        }
    }


    update(): Promise<any> {
        if (this._activeHTMLRemoved) return Promise.resolve(this);
        return this.updateAttribute('id').then(
            () => this.updateClassList().then(
            () => this.updateStyles().then(
            () => this.updateBody().then(
            () => this.updateAttributes().then(
            () => this.updateEvents().then(
            () => this.updateOnHandlers().then(
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
        if (this._activeHTMLRemoved) return;
        const target = e.target as HTMLInputElement;
        const el = this.el as HTMLInputElement;
        let value: string;
        if (el.type === 'checkbox' || el.type === 'radio') value = target.checked ? 'true' : 'false';
        else if (el.hasAttribute('multiple')) value = Array.from((this.el as HTMLSelectElement).selectedOptions).map(option => option.value).join('&&');
        else value = target.value;
        if (value !== undefined && value !== this.model.get('value')) {
            this.model.set('value', value, {updated_view: this});
            this.touch();
        }
    }

    setData(key: string, value: any) {
        if (this._activeHTMLRemoved) return;
        this.model.set('exportData', {...this.model.get('exportData'), [key]: value}, {updated_view: this});
        this.touch();
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
        let result: Promise<any> = Promise.resolve();
        if (method !== "") {
            result = this.callHandler(method, e).catch(error => this.model.trigger('handler:error', error));
        }
        if (send) {
            this.sendEventMessage(e, this.constructEventMessage(e, props, eventName));
        }
        return result;
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
    constructEventMessage(e: Event, props?: string[], eventName?: string) {
        props = props || this.model.get('defaultEventProperties') || ['target'];
        const message: Record<string, any> = {};
        if (eventName !== undefined) message.eventName = eventName;
        for (const prop of props!) {
            if (prop === 'target') {
                const target = e.target as HTMLElement;
                if (!target || typeof target.getAttributeNames !== 'function') { message.target = null; continue; }
                const data: Record<string, any> = {tag: target.tagName};
                if (this.model.get('eventTargetMode') === 'legacy') {
                    data.innerHTML = target.innerHTML;
                    for (const name of target.getAttributeNames()) data[name] = target.getAttribute(name);
                } else {
                    for (const name of this.model.get('eventTargetFields') || []) {
                        const value = name in target ? (target as any)[name] : target.getAttribute(name);
                        if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) data[name] = value;
                    }
                }
                message.target = data;
            } else {
                // Accept older field names without keeping their spelling as defaults.
                const name = prop === 'timestamp' ? 'timeStamp' : prop === 'alKey' ? 'altKey' : prop;
                const value = (e as any)[name];
                if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) message[prop] = value;
                else if (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
                    try {
                        message[prop] = JSON.parse(JSON.stringify(value, (_key, item) => item instanceof Node ? undefined : item));
                    } catch { /* Cyclic fields cannot cross the widget JSON protocol. */ }
                }
            }
        }
        return message;
    }
    _flushEvents(): void {
        if (this._eventTimer !== null) clearTimeout(this._eventTimer);
        this._eventTimer = null;
        const pending = Array.from(this._pendingEvents.values());
        this._pendingEvents.clear();
        if (!this._activeHTMLRemoved) pending.forEach(message => this.send(message));
    }
    sendEventMessage(e: Event, message?: Record<string, any>) {
        if (e.type === 'remove') {
            if (!(this.model as ActiveHTMLModel)._activeHTMLClosed) this.send(message || this.constructEventMessage(e));
            return;
        }
        if (this._activeHTMLRemoved) return;
        message = message || this.constructEventMessage(e);
        const delay = this.model.get('eventThrottleMs') || 0;
        const name = message.eventName || message.type || e.type;
        if (delay > 0 && (this.model.get('coalescedEvents') || []).includes(name)) {
            this._pendingEvents.set(name, message);
            if (this._eventTimer === null) this._eventTimer = setTimeout(() => this._flushEvents(), delay);
        } else {
            this._flushEvents();
            this.send(message);
        }
    }

}
