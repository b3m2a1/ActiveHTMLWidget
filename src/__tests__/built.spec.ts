// Run after building both frontend distributions: ACTIVEHTML_TEST_BUILT=1 npm test.
import * as widgets from '@jupyter-widgets/base';
import * as luminoWidgets from '@lumino/widgets';
import * as algorithm from '@lumino/algorithm';
import * as messaging from '@lumino/messaging';
import {readFileSync} from 'fs';
import * as path from 'path';
import {createTestModel, DummyManager} from './utils';

const root = path.resolve(__dirname, '../..');
const built = process.env.ACTIVEHTML_TEST_BUILT === '1' ? describe : describe.skip;

function classic() {
  let exports: any;
  const define = (dependencies: string[], factory: (...args: any[]) => any) => {
    expect(dependencies).toEqual(['@jupyter-widgets/base']);
    exports = factory(widgets);
  };
  new Function('define', readFileSync(path.join(root, 'ActiveHTMLWidget/nbextension/index.js'), 'utf8'))(define);
  return exports;
}

async function federated() {
  const directory = path.join(root, 'ActiveHTMLWidget/labextension');
  const data = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const script = document.createElement('script');
  script.src = 'http://localhost/ActiveHTMLWidget/' + data.jupyterlab._build.load;
  const current = Object.getOwnPropertyDescriptor(document, 'currentScript');
  Object.defineProperty(document, 'currentScript', {configurable: true, value: script});
  const append = document.head.appendChild.bind(document.head);
  const loader = jest.spyOn(document.head, 'appendChild').mockImplementation((element: any) => {
    if (element.tagName !== 'SCRIPT') return append(element);
    const filename = new URL(element.src).pathname.split('/').pop()!;
    new Function(readFileSync(path.join(directory, 'static', filename), 'utf8'))();
    if (element.onload) element.onload({type: 'load', target: element});
    return element;
  });
  try {
    const container = new Function(readFileSync(path.join(directory, data.jupyterlab._build.load), 'utf8') + '\nreturn _JUPYTERLAB.ActiveHTMLWidget;')();
    const scope: any = {};
    for (const [name, exports] of Object.entries({
      '@jupyter-widgets/base': widgets,
      '@lumino/widgets': luminoWidgets,
      '@lumino/algorithm': algorithm,
      '@lumino/messaging': messaging
    })) {
      const version = JSON.parse(readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
      scope[name] = {[version]: {get: () => () => exports, from: 'artifact-test', loaded: true}};
    }
    await container.init(scope);
    const exports = (await container.get('./index'))();
    const plugin = (await container.get('./extension'))().default;
    const registry = {registerWidget: jest.fn()};
    plugin.activate({}, registry);
    expect(registry.registerWidget).toHaveBeenCalledWith(expect.objectContaining({name: 'ActiveHTMLWidget', version: '0.2.0'}));
    return exports;
  } finally {
    loader.mockRestore();
    if (current) Object.defineProperty(document, 'currentScript', current);
    else delete (document as any).currentScript;
  }
}

built('built frontend distributions', () => {
  it.each([['classic AMD', classic], ['JupyterLab federation', federated]])('loads %s and supports DOM callbacks and teardown', async (_name, load) => {
    const exports: any = await (load as () => any)();
    const model: any = createTestModel(exports.ActiveHTMLModel, {
      tagName: 'input', value: 'live',
      jsHandlers: {cancel: 'event.preventDefault();'},
      eventPropertiesDict: {click: {method: 'cancel'}}
    });
    (model.widget_manager as DummyManager).testClasses.ActiveHTMLView = exports.ActiveHTMLView;
    let view: any;
    try {
      await model.ready();
      view = await model.widget_manager.create_view(model);
      expect(model.get('_model_module_version')).toBe('0.2.0');
      expect(view.el.tagName).toBe('INPUT');
      const event = new MouseEvent('click', {cancelable: true});
      view.el.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      const message = view.constructEventMessage({target: view.el}, ['target']);
      expect(message.target.value).toBe('live');
      expect(message.target).not.toHaveProperty('innerHTML');
    } finally {
      if (view) view.remove();
      await model.close();
    }
  });
});
