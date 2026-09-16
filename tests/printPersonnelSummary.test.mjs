import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('/home/runner/work/gyeonggi-dashboard/gyeonggi-dashboard/index.html', 'utf8');

function extractFunctionSource(name) {
    const signature = `function ${name}()`;
    const start = html.indexOf(signature);
    assert.notEqual(start, -1, `${name} source not found`);

    const braceStart = html.indexOf('{', start);
    let depth = 0;
    for (let i = braceStart; i < html.length; i += 1) {
        const char = html[i];
        if (char === '{') depth += 1;
        if (char === '}') {
            depth -= 1;
            if (depth === 0) return html.slice(start, i + 1);
        }
    }

    throw new Error(`Failed to extract ${name}`);
}

const printPersonnelSummarySource = extractFunctionSource('printPersonnelSummary');

function instantiatePrintPersonnelSummary({ document, window, alert, console }) {
    return Function(
        'document',
        'window',
        'alert',
        'console',
        `${printPersonnelSummarySource}; return printPersonnelSummary;`
    )(document, window, alert, console);
}

function createSanitizableElement(htmlMarkup) {
    return {
        cloneNode() {
            return {
                outerHTML: htmlMarkup,
                querySelectorAll() {
                    return [];
                }
            };
        }
    };
}

test('printPersonnelSummary alerts and exits when required DOM nodes are missing', () => {
    const alerts = [];
    let createElementCalled = false;

    const printPersonnelSummary = instantiatePrintPersonnelSummary({
        document: {
            getElementById() {
                return null;
            },
            createElement() {
                createElementCalled = true;
                throw new Error('should not create iframe when DOM is missing');
            },
            body: {
                appendChild() {},
                contains() {
                    return false;
                }
            }
        },
        window: {
            setTimeout() {
                throw new Error('should not schedule timers when DOM is missing');
            },
            clearTimeout() {},
            addEventListener() {},
            removeEventListener() {}
        },
        alert(message) {
            alerts.push(message);
        },
        console
    });

    printPersonnelSummary();

    assert.deepEqual(alerts, ['인쇄할 인원 현황 데이터를 찾을 수 없습니다.']);
    assert.equal(createElementCalled, false);
});

test('printPersonnelSummary cleans up the iframe when preparation times out', () => {
    const alerts = [];
    const timers = [];
    let removed = false;
    const listeners = new Map();

    const iframe = {
        style: {},
        contentWindow: {
            focus() {},
            print() {
                throw new Error('print should not run before iframe load');
            },
            onafterprint: null
        },
        setAttribute() {},
        addEventListener(type, handler) {
            listeners.set(type, handler);
        },
        remove() {
            removed = true;
        }
    };

    const summary = createSanitizableElement('<div class="personnel-summary"></div>');
    const table = createSanitizableElement('<div class="personnel-table-container"></div>');
    const personnelCard = {
        querySelector(selector) {
            assert.equal(selector, '.personnel-table-container');
            return table;
        }
    };

    const printPersonnelSummary = instantiatePrintPersonnelSummary({
        document: {
            getElementById(id) {
                if (id === 'personnel-card') return personnelCard;
                if (id === 'personnel-summary') return summary;
                return null;
            },
            createElement(tag) {
                assert.equal(tag, 'iframe');
                return iframe;
            },
            body: {
                appendChild(node) {
                    assert.equal(node, iframe);
                },
                contains(node) {
                    return node === iframe && !removed;
                }
            }
        },
        window: {
            setTimeout(callback, delay) {
                timers.push({ callback, delay });
                return timers.length;
            },
            clearTimeout() {},
            addEventListener() {},
            removeEventListener() {}
        },
        alert(message) {
            alerts.push(message);
        },
        console
    });

    printPersonnelSummary();

    const timeoutTimer = timers.find(timer => timer.delay === 5000);
    assert.ok(timeoutTimer, 'expected iframe preparation timeout to be scheduled');
    timeoutTimer.callback();

    const cleanupTimer = timers.find(timer => timer.delay === 300);
    assert.ok(cleanupTimer, 'expected cleanup timer to be scheduled after timeout');
    cleanupTimer.callback();

    assert.equal(removed, true);
    assert.deepEqual(alerts, ['인쇄 화면을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.']);
});
