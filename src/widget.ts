// Copyright (c) b3m2a1
// Distributed under the terms of the Modified BSD License.

import {
    unpack_models,
    reject,
    DOMWidgetModel,
    DOMWidgetView,
    WidgetModel,
    ViewList,
    ISerializers,
} from '@jupyter-widgets/base';

import {MODULE_NAME, MODULE_VERSION} from './version';

import {Widget, PanelLayout} from '@lumino/widgets';
import {ArrayExt} from '@lumino/algorithm';
import {
    Message, MessageLoop
} from '@lumino/messaging';
import $ from 'jquery';

// Import the CSS
import '../css/widget.css';

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
            ]
        };
    }

    static serializers: ISerializers = {
        ...DOMWidgetModel.serializers,
        // Add any extra serializers here
        //@ts-ignore
        children: {deserialize: unpack_models}
    };

    static model_name = 'ActiveHTMLModel';
    static model_module = MODULE_NAME;
    static model_module_version = MODULE_VERSION;
    static view_name = 'ActiveHTMLView'; // Set to null if no view
    static view_module = MODULE_NAME; // Set to null if no view
    static view_module_version = MODULE_VERSION;

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
        this._currentStyles = new Set();
    }

    // Manage CSS styles
    _currentStyles: Set<string>;
    removeStyles(): void {
        let newStyles = this.model.get("styleDict");
        let current = this._currentStyles;
        for (let prop of current) {
            if (!newStyles.hasOwnProperty(prop)) {
                this.el.style.removeProperty(prop);
                this._currentStyles.delete(prop);
            }
        }
    }
    setLayout(layout: WidgetModel, oldLayout?: WidgetModel) {} // null override
    setStyle(style: WidgetModel, oldStyle?: WidgetModel) {} // null override
    setStyles(): void {
        let elementStyles = this.model.get("styleDict");
        if (elementStyles.length === 0) {
            this._currentStyles.clear();
            this.el.removeAttribute('style');
        } else {
            if (this.model.get("_debugPrint")) {
                console.log(this.el, "Element Styles:", elementStyles);
            }
            for (let prop in elementStyles) {
                if (elementStyles.hasOwnProperty(prop)) {
                    // console.log(">>>", prop, elementStyles[prop], typeof prop);
                    this.el.style.setProperty(prop, elementStyles[prop]);
                    // console.log("<<<", prop, this.el.style.getPropertyValue(prop));
                    this._currentStyles.add(prop);
                }
            }
        }
    }
    updateStyles() {
        this.setStyles();
        this.removeStyles();
    }

    // Manage classes
    updateClassList(): void {
        if (this.model.get("_debugPrint")) {
            console.log(this.el, "Element Classes:", this.model.get("classList"));
        }
        //@ts-ignore
        this.el.classList.remove(...this.el.classList);
        for (let cls of this.model.get("classList")) {
            this.el.classList.add(cls);
        }
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
    update_children() {
        if (this.children_views !== null) {
            this.children_views.update(this.model.get('children')).then((views: DOMWidgetView[]) => {
                // Notify all children that their sizes may have changed.
                views.forEach((view) => {
                    MessageLoop.postMessage(view.pWidget, Widget.ResizeMessage.UnknownSize);
                });
            });
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
        }).catch(reject('Could not add child view to box', true));
    }
    children_views: ViewList<DOMWidgetView> | null;
    remove(): void {
        this.children_views = null;
        super.remove();
    }

    updateBody(): void {
        let children = this.model.get('children');
        let debug = this.model.get("_debugPrint");
        if (children.length > 0) {
            if (debug) { console.log(this.el, "Updating Children..."); }
            this.update_children();
        } else {
            let html = this.model.get("innerHTML");
            if (html.length > 0) {
                if (debug) { console.log(this.el, "Updating HTML..."); }
                this.updateInnerHTML();
            } else {
                let text = this.model.get("textContent");
                if (text.length > 0) {
                    if (debug) { console.log(this.el, "Updating Text..."); }
                    this.updateTextContent();
                } else {
                    if (debug) { console.log(this.el, "Updating HTML..."); }
                    this.updateInnerHTML();
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

    // Setting attributes (like id)
    updateAttribute(attrName: string): void {
        let val = this.model.get(attrName);
        if (val === "") {
            this.el.removeAttribute(attrName);
        } else {
            this.el.setAttribute(attrName, val);
        }
    }
    updateAttributeFromQuery(attrName: string, queryName: string): void {
        let val = this.model.get(queryName);
        if (val === "") {
            this.el.removeAttribute(attrName);
        } else {
            this.el.setAttribute(attrName, val);
        }
    }
    updateAttributes() {
        let attrs = this.model.get('elementAttributes');
        let debug = this.model.get("_debugPrint");
        if (debug) { console.log(this.el, "Element Properties:", attrs); }
        for (let prop in attrs) {
            let val = attrs[prop];
            if (val === "") {
                this.el.removeAttribute(prop);
            } else {
                this.el.setAttribute(prop, val);
            }
        }
    }
    updateValue() {
        let el = this.el as HTMLInputElement;
        if (el !== undefined) {
            let val = el.value;
            if (val !== undefined) {
                let newVal = this.model.get('value');
                if (newVal !== val) {
                    el.value = newVal;
                }
            }
        }
    }

    _currentEvents: Record<string, any>;
    setEvents() {
        let listeners = this.model.get('eventPropertiesDict') as Record<string, string[]>;
        let debug = this.model.get("_debugPrint");
        if (debug) { console.log(this.el, "Adding Events:", listeners); }
        for (let key in listeners) {
            if (listeners.hasOwnProperty(key)) {
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
        }
    }
    removeEvents(): void {
        let newListeners = this.model.get('eventPropertiesDict') as Record<string, string[]>;
        let current = this._currentEvents;
        let debug = this.model.get("_debugPrint");
        for (let prop in current) {
            if (current.hasOwnProperty(prop)) {
                if (!newListeners.hasOwnProperty(prop)) {
                    if (debug) { console.log(this.el, "Removing Event:", prop); }
                    this.el.removeEventListener(prop, this._currentEvents[prop][1]);
                    this._currentEvents.delete(prop);
                }
            }
        }
    }
    updateEvents(): void {
        this.setEvents();
        this.removeEvents();
    }

    render() {
        super.render();
        this.el.classList.remove('lm-Widget', 'p-Widget')
        this.update();
    }
    update(): void {
        this.updateBody();
        // this.updateTextContent();
        this.updateAttribute('id');
        this.updateValue();
        this.updateAttributes();
        this.updateClassList();
        this.setStyles();
        this.setEvents();
        // this.el.classList = this.model.get("classList");
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
        let val = target.value;
        if (val !== undefined) {
            this.model.set('value', val, {updated_view: this});
            this.touch();
        }
    }

    constructEventListener(eventName:string, props:string[]) {
        let parent = this;
        return function (e:Event) {
            let debug = parent.model.get('_debugPrint');
            if (debug) {
                console.log(parent.el, "Handling event:", eventName)
            }
            // console.log("|", eventName, props);
            parent.sendEventMessage(e, parent.constructEventMessage(e, props, eventName));
        };
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
        e.stopPropagation();
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
