#!/bin/bash

root=$PWD
target=$1
node_modules/.bin/sass css/bootstrap.scss css/bootstrap.css && \
rm ActiveHTMLWidget/labextension/build_log.json && \
python3 postprocess_css.py && \
  npm run build && \
  rm -rf $target && \
  cp -r $root/ActiveHTMLWidget $target && \
  cp $root/ActiveHTMLWidget.json $target && \
  cp $root/install.json $target