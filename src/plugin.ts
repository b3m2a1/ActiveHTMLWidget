// Copyright (c) b3m2a1.
// Distributed under the terms of the Modified BSD License.
import {IJupyterWidgetRegistry} from '@jupyter-widgets/base';
import * as widgetExports from './widget';
import {MODULE_NAME, MODULE_VERSION} from './version';

// JupyterLab's plugin contract needs no legacy Phosphor application wrapper.
const plugin = {
    id: 'ActiveHTMLWidget:plugin',
    requires: [IJupyterWidgetRegistry],
    autoStart: true,
    activate: (_app: unknown, registry: IJupyterWidgetRegistry): void => {
        registry.registerWidget({name: MODULE_NAME, version: MODULE_VERSION, exports: widgetExports});
    }
};
export default plugin;
