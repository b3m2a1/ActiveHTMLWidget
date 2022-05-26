#!/bin/bash

root=$PWD
target=$1
node_modules/.bin/sass css/bootstrap.scss css/bootstrap.css && \
node_modules/.bin/sass css/reset.scss css/reset.css && \
rm -f ActiveHTMLWidget/labextension/build_log.json && \
python3 postprocess_css.py && \
  npm run build && \
  rm -f ActiveHTMLWidget/labextension/build_log.json && \
  rm -rf $target && \
  cp -r $root/ActiveHTMLWidget $target && \
  cp $root/ActiveHTMLWidget.json $target && \
  cp $root/install.json $target