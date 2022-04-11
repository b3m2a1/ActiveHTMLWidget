#!/usr/bin/env python
# coding: utf-8

# Copyright (c) b3m2a1.
# Distributed under the terms of the Modified BSD License.

import pytest

from ..example import ExampleWidget


def test_example_creation_blank():
    w = ExampleWidget()
    assert w.value == 'Hello World'
