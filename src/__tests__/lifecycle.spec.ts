import { ActiveHTMLModel, ActiveHTMLView } from "../widget";
import { createTestModel, DummyManager } from "./utils";
const models: ActiveHTMLModel[] = [],
  views: ActiveHTMLView[] = [];
const tick = async () => {
  for (let i = 0; i < 16; i++) await Promise.resolve();
};
async function model(attrs: any = {}) {
  const value = createTestModel(ActiveHTMLModel, attrs);
  (value.widget_manager as DummyManager).testClasses.ActiveHTMLView =
    ActiveHTMLView;
  models.push(value);
  await value.ready();
  return value;
}
async function view(attrs: any = {}) {
  const value = await model(attrs);
  const result = (await value.widget_manager.create_view(
    value
  )) as ActiveHTMLView;
  views.push(result);
  return result;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
afterEach(async () => {
  views.splice(0).forEach((v) => v.remove());
  await Promise.all(models.splice(0).map((m) => m.close()));
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("handler lifetime", () => {
  it("shares readiness and compiles a changed handler once", async () => {
    const m = await model();
    const compile = jest.spyOn(m, "_defineHandler");
    await Promise.all([m.ready(), m.ready(), m.ready()]);
    m.set("jsHandlers", { test: "return 5;" });
    await m.ready();
    expect(compile).toHaveBeenCalledTimes(1);
    expect(await m.callHandler("test", m.dummyEvent("test"))).toBe(5);
  });
  it("removes deleted code and accepts handler names as data", async () => {
    const m = await model({ jsHandlers: { "with-dash": "return 7;" } });
    expect(await m.callHandler("with-dash", m.dummyEvent("test"))).toBe(7);
    m.set("jsHandlers", {});
    await m.ready();
    await expect(
      m.callHandler("with-dash", m.dummyEvent("test"))
    ).rejects.toThrow("find");
  });
  it("compares full sources rather than colliding string hashes", async () => {
    const m = await model({ jsHandlers: { test: "return 'Aa';" } });
    m.set("jsHandlers", { test: "return 'BB';" });
    await m.ready();
    expect(await m.callHandler("test", m.dummyEvent("test"))).toBe("BB");
  });
  it("discards a stale module resolution", async () => {
    const a = deferred<any>(),
      b = deferred<any>();
    jest
      .spyOn(ActiveHTMLModel, "_importModule")
      .mockImplementation((source) => (source === "a" ? a.promise : b.promise));
    const m = await model();
    m.set("jsHandlers", { src: "a" });
    const old = m._apiLoader!;
    m.set("jsHandlers", { src: "b" });
    b.resolve({ which: () => "b" });
    await m.ready();
    a.resolve({ which: () => "a" });
    await old;
    expect(await m.callHandler("which", m.dummyEvent("test"))).toBe("b");
  });
  it("does not install code after close", async () => {
    const pending = deferred<any>();
    jest
      .spyOn(ActiveHTMLModel, "_importModule")
      .mockReturnValue(pending.promise);
    const m = await model();
    m.set("jsHandlers", { src: "late" });
    const ready = m._apiLoader!;
    await m.close();
    pending.resolve({ late: () => 1 });
    await ready;
    expect(Object.keys(m.get("_ihandlers"))).toHaveLength(0);
  });
  it("propagates asynchronous command rejection to the comm caller", async () => {
    const m = await model({
      jsHandlers: { fail: 'return Promise.reject(new Error("failed"));' },
    });
    await expect(
      m._handle_comm_msg({
        content: { data: { method: "call", content: { handle: "fail" } } },
        buffers: [],
      } as any)
    ).rejects.toThrow("failed");
  });
});

describe("DOM ownership and cleanup", () => {
  it("runs initialize exactly once", async () => {
    const v = await view({
      jsHandlers: {
        init: "widget.el.dataset.count=String(Number(widget.el.dataset.count || 0)+1);",
      },
      onevents: { initialize: { method: "init" } },
    });
    await v.render();
    await tick();
    expect(v.el.dataset.count).toBe("1");
  });
  it("removes obsolete managed classes without touching foreign classes", async () => {
    const v = await view({ classList: ["old"] });
    v.el.classList.add("foreign");
    v.model.set("classList", ["new"]);
    await v.updateClassList();
    expect(v.el.classList.contains("old")).toBe(false);
    expect(v.el.classList.contains("new")).toBe(true);
    expect(v.el.classList.contains("foreign")).toBe(true);
  });
  it("preserves unmanaged styles when its own styles are cleared", async () => {
    const v = await view({ styleDict: { color: "red" } });
    v.el.style.backgroundColor = "blue";
    v.model.set("styleDict", {});
    await v.updateStyles();
    expect(v.el.style.color).toBe("");
    expect(v.el.style.backgroundColor).toBe("blue");
  });
  it("honors the Python unsyncedProps alias", async () => {
    const v = await view({
      unsyncedProps: ["color", "title"],
      styleDict: { color: "red" },
      elementAttributes: { title: "managed" },
    });
    expect(v.el.style.color).toBe("");
    expect(v.el.hasAttribute("title")).toBe(false);
  });
  it("removes disappeared attributes and fires the right attribute event", async () => {
    const v = await view({
      jsHandlers: { changed: 'widget.el.dataset.changed="yes";' },
      onevents: { "view-change:title": { method: "changed" } },
    });
    v.model.set("elementAttributes", { title: "hello" });
    await v.updateAttributes();
    await tick();
    expect(v.el.dataset.changed).toBe("yes");
    v.model.set("elementAttributes", {});
    await v.updateAttributes();
    expect(v.el.hasAttribute("title")).toBe(false);
  });
  it("reuses widget-backed attributes and releases their listeners", async () => {
    const child = await model({ innerHTML: "child" });
    const v = await view();
    const create = jest.spyOn(v, "create_child_view");
    v.model.set("elementAttributes", { "data-content": child });
    await Promise.all([v.updateAttributes(), v.updateAttributes()]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(v._attributeBindings.size).toBe(1);
    const record = v._attributeBindings.get("data-content")!;
    const remove = jest.spyOn(record.view, "remove");
    v.model.set("elementAttributes", {});
    await v.updateAttributes();
    expect(remove).toHaveBeenCalled();
    expect(v._attributeBindings.size).toBe(0);
    expect((child as any)._events?.change || []).toHaveLength(0);
  });
  it("does not remove externally owned attribute views", async () => {
    const external = await view({ innerHTML: "child" });
    const v = await view();
    const remove = jest.spyOn(external, "remove");
    await v._updateAttribute("data-content", { "data-content": external });
    v.remove();
    expect(remove).not.toHaveBeenCalled();
  });
  it("preserves child views during recursive rendering", async () => {
    const child = await model({ textContent: "child" });
    const v = await view({ children: [child] });
    await v.renderChildren();
    expect(v.el.textContent).toBe("child");
    expect(v.children_views!.views).toHaveLength(1);
  });
  it("releases children when switching to raw HTML without closing their models", async () => {
    const child = await model({ textContent: "child" });
    const v = await view({ children: [child] });
    const childView = await v.children_views!.views[0];
    const remove = jest.spyOn(childView, "remove");
    v.model.set({ children: [], innerHTML: "<b>replacement</b>" });
    await v.updateBody();
    await tick();
    await v._bodyUpdate;
    expect(v.el.innerHTML).toBe("<b>replacement</b>");
    expect(remove).toHaveBeenCalled();
    expect(child._activeHTMLClosed).toBe(false);
  });
  it("cleans model and DOM listeners and removes idempotently", async () => {
    const v = await view({
      eventPropertiesDict: { click: [] },
      onevents: { custom: [] },
    });
    const send = jest.spyOn(v, "send");
    v.model.trigger("custom", {});
    expect(send).toHaveBeenCalledTimes(1);
    v.remove();
    v.remove();
    v.el.dispatchEvent(new Event("click"));
    v.model.trigger("custom", {});
    expect(send).toHaveBeenCalledTimes(1);
    expect(Object.keys(v._currentEvents)).toHaveLength(0);
    expect(Object.keys(v._currentOnHandlers)).toHaveLength(0);
    expect((v.model as any)._events?.custom || []).toHaveLength(0);
  });
  it("removes one view without disconnecting another view of the same model", async () => {
    const m = await model({ onevents: { custom: [] } });
    const first = (await m.widget_manager.create_view(m)) as ActiveHTMLView;
    const second = (await m.widget_manager.create_view(m)) as ActiveHTMLView;
    views.push(first, second);
    const a = jest.spyOn(first, "send"),
      b = jest.spyOn(second, "send");
    first.remove();
    m.trigger("custom", {});
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
  it("keeps the final body after rapidly changing body representations", async () => {
    const child = await model({ textContent: "first" }),
      last = await model({ textContent: "last" });
    const v = await view({ children: [child] });
    v.model.set({ children: [], innerHTML: "<b>middle</b>" });
    v.model.set({ children: [last], innerHTML: "" });
    await tick();
    await v._bodyUpdate;
    expect(v.el.textContent).toBe("last");
    expect(v.children_views!.views).toHaveLength(1);
  });
  it("disposes a child that resolves after its parent was removed", async () => {
    const v = await view();
    const child = await view();
    const pending = deferred<any>();
    jest.spyOn(v, "create_child_view").mockReturnValue(pending.promise);
    const adding = v.add_child_model(child.model);
    const remove = jest.spyOn(child, "remove");
    v.remove();
    pending.resolve(child);
    await adding;
    expect(remove).toHaveBeenCalled();
    expect(v.el.contains(child.el)).toBe(false);
  });
});

describe("teardown hooks", () => {
  it("runs a registered remove handler once, even when the model closes", async () => {
    const v = await view({
      jsHandlers: {
        cleanup:
          "widget.el.dataset.cleaned=String(Number(widget.el.dataset.cleaned || 0)+1);",
      },
      onevents: { remove: { method: "cleanup" } },
    });
    await v.model.close();
    await tick();
    expect(v.el.dataset.cleaned).toBe("1");
    v.remove();
    expect(v.el.dataset.cleaned).toBe("1");
  });
  it("waits for an asynchronous remove handler before discarding its code", async () => {
    const v = await view({
      jsHandlers: {
        cleanup:
          'return Promise.resolve().then(()=>{widget.el.dataset.cleaned="yes";});',
      },
      onevents: { remove: { method: "cleanup" } },
    });
    await v.model.close();
    expect(v.el.dataset.cleaned).toBe("yes");
    expect(Object.keys(v.model.get("_ihandlers"))).toHaveLength(0);
  });
});

describe("communication", () => {
  it("serializes live input values without subtree HTML by default", async () => {
    const v = await view({ tagName: "input" });
    (v.el as HTMLInputElement).value = "fresh";
    v.el.setAttribute("value", "old");
    const payload = v.constructEventMessage(
      { target: v.el, type: "input" } as any,
      ["target"]
    );
    expect(payload.target.value).toBe("fresh");
    expect(payload.target).not.toHaveProperty("innerHTML");
  });
  it("can explicitly retain legacy target snapshots", async () => {
    const v = await view({
      eventTargetMode: "legacy",
      innerHTML: "<b>legacy</b>",
    });
    const payload = v.constructEventMessage({ target: v.el } as any, [
      "target",
    ]);
    expect(payload.target.innerHTML).toBe("<b>legacy</b>");
  });
  it("supports old event field spellings and corrected defaults", async () => {
    const v = await view();
    const payload = v.constructEventMessage(
      { timeStamp: 12, altKey: true } as any,
      ["timestamp", "alKey"]
    );
    expect(payload).toEqual({ timestamp: 12, alKey: true });
    expect(v.model.get("defaultEventProperties")).toContain("altKey");
  });
  it("preserves explicitly requested JSON CustomEvent detail", async () => {
    const v = await view();
    const payload = v.constructEventMessage(
      { detail: { number: 3, values: [1, 2] } } as any,
      ["detail"]
    );
    expect(payload.detail).toEqual({ number: 3, values: [1, 2] });
  });
  it("does not send unchanged input state", async () => {
    const v = await view({ tagName: "input", value: "same" });
    const touch = jest.spyOn(v, "touch");
    for (let i = 0; i < 100; i++) v.handleChanged({ target: v.el } as any);
    expect(touch).not.toHaveBeenCalled();
    (v.el as HTMLInputElement).value = "new";
    v.handleChanged({ target: v.el } as any);
    v.handleChanged({ target: v.el } as any);
    expect(touch).toHaveBeenCalledTimes(1);
  });
  it("uses one immutable exportData assignment", async () => {
    const v = await view();
    const old = v.model.get("exportData");
    const changed = jest.fn();
    v.model.on("change:exportData", changed);
    v.setData("answer", 42);
    expect(old).toEqual({});
    expect(v.model.get("exportData")).toEqual({ answer: 42 });
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it("coalesces opted-in motion events, preserves clicks, flushes final events", async () => {
    jest.useFakeTimers();
    const v = await view({ eventThrottleMs: 20 });
    const send = jest.spyOn(v, "send");
    for (let i = 0; i < 100; i++)
      v.sendEventMessage({ type: "pointermove" } as any, {
        type: "pointermove",
        x: i,
      });
    expect(send).not.toHaveBeenCalled();
    jest.advanceTimersByTime(20);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith({ type: "pointermove", x: 99 });
    v.sendEventMessage({ type: "input" } as any, {
      type: "input",
      value: "final",
    });
    v.sendEventMessage({ type: "change" } as any, { type: "change" });
    expect(send).toHaveBeenNthCalledWith(2, { type: "input", value: "final" });
    v.sendEventMessage({ type: "click" } as any, { type: "click" });
    expect(send).toHaveBeenCalledTimes(4);
  });
  it("drops pending motion messages when removed", async () => {
    jest.useFakeTimers();
    const v = await view({ eventThrottleMs: 20 });
    const send = jest.spyOn(v, "send");
    v.sendEventMessage({ type: "pointermove" } as any, { type: "pointermove" });
    v.remove();
    jest.runAllTimers();
    expect(send).not.toHaveBeenCalled();
  });
});


describe('synchronous browser event handling', () => {
  it('allows a ready local handler to cancel the actual DOM event immediately', async () => {
    const v = await view({jsHandlers: {cancel: 'event.preventDefault();'}, eventPropertiesDict: {click: {method: 'cancel'}}});
    const event = new MouseEvent('click', {cancelable: true});
    v.el.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
  it('also invokes a ready shared API in the event stack', async () => {
    const api = await model({jsHandlers: {cancel: 'event.preventDefault();'}});
    const v = await view({jsAPI: api, eventPropertiesDict: {click: {method: 'cancel'}}});
    const event = new MouseEvent('click', {cancelable: true});
    v.el.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
