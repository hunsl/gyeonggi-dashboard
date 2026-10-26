import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const moduleSource = html.split('<script type="module">')[1].split('</script>')[0]
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^init\(\);/m, '');
function app(courses = []) {
    const elements = new Map();
    const context = vm.createContext({
        initializeApp: () => ({}), getFirestore: () => ({}),
        document: { addEventListener() {}, getElementById(id) {
            if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', className: '' });
            return elements.get(id);
        } }, window: {}, console, setTimeout, clearTimeout
    });
    vm.runInContext(moduleSource, context);
    context.fixture = structuredClone(courses);
    vm.runInContext('courses = fixture', context);
    return { context, elements, run: code => vm.runInContext(code, context) };
}

test('blank history is unknown; a recorded unfinished task can be zero', () => {
    const a = app();
    assert.equal(a.run("calcProgress({checklist: [{task:'OT', isCompleted:false, note:''}]})"), null);
    assert.equal(a.run("calcProgress({checklist: [{task:'OT', isCompleted:false, note:'확인 중'}]})"), 0);
    assert.equal(a.run("calcProgress({checklist: [{isCompleted:true},{isCompleted:false}]})"), 50);
    assert.equal(a.run("calcProgress({checklist: {a:{isCompleted:true},b:{isCompleted:false}}})"), 50);
});

test('missing workflow history is excluded from the average without modifying input', () => {
    const a = app([{checklist:[{isCompleted:true}]}, {checklist:[{isCompleted:false}]}]);
    const before = JSON.stringify(a.context.fixture);
    assert.equal(a.run('overallProgress()'), 100);
    assert.equal(JSON.stringify(a.context.fixture), before);
    assert.equal(app([{}]).run('overallProgress()'), null);
});

test('course states are evidence labels only; explicit states retain precedence', () => {
    const a = app();
    assert.equal(a.run("getCourseDisplayStatus({statistics:{completed:16}}).label"), '수료실적 등록');
    assert.equal(a.run("getCourseDisplayStatus({statistics:{enrolled:25}}).label"), '교육참여 등록');
    assert.equal(a.run("getCourseDisplayStatus({status:'inprogress',statistics:{completed:16}}).label"), '진행중');
    assert.equal(a.run('getCourseDisplayStatus({}).label'), '상태 확인 필요');
});

test('board uses labelled completion ratios and shows genuine zero employment rates', () => {
    const a = app([{id:'1', name:'테스트 <과정>', color:'#2563EB', statistics:{passed:25, enrolled:20, completed:16, employed:0}, checklist:[{isCompleted:false}]}]);
    const before = JSON.stringify(a.context.fixture);
    a.run('renderCourseProgressBoard()');
    const markup = a.elements.get('course-progress-board').innerHTML;
    assert.match(markup, /80%/);
    assert.match(markup, /수료 16명 \/ 교육참여 20명/);
    assert.match(markup, /업무 체크리스트 · 기록 확인 필요/);
    assert.match(markup, />0%<\/div>/);
    assert.match(markup, /테스트 &lt;과정&gt;/);
    assert.equal(JSON.stringify(a.context.fixture), before);
});

test('weekday calendar columns stay on Monday through Friday', () => {
    const a = app();
    assert.equal(
        a.run('JSON.stringify(calendarWeekdays(2026, 9).slice(0, 5).map(d => [d.month + 1, d.day, d.dow]))'),
        '[[9,28,1],[9,29,2],[9,30,3],[10,1,4],[10,2,5]]'
    );
    assert.equal(a.run('calendarWeekdays(2026, 9).find(d => d.month === 9 && d.day === 26).dow'), 1);
    assert.equal(a.run('calendarWeekdays(2026, 9).some(d => d.dow === 0 || d.dow === 6)'), false);
    assert.equal(a.run('calendarWeekdays(2026, 9).every((d, i) => d.dow === (i % 5) + 1)'), true);
});

test('public holidays are labelled on the weekday calendar', () => {
    const a = app();
    assert.equal(a.run("publicHolidayName('2026-10-05')"), '개천절 대체');
    assert.equal(a.run("publicHolidayName('2026-10-09')"), '한글날');
    assert.equal(a.run("publicHolidayName('2026-10-03')"), '개천절');
    assert.equal(a.run("publicHolidayName('2026-10-26')"), '');
    assert.equal(a.run("publicHolidayName('2026-02-17')"), '설날');
});

test('page startup with empty storage performs no database write or initialization', async () => {
    const a = app();
    a.context.collection = () => ({});
    a.context.getDocs = async () => ({ empty:true });
    a.context.setDoc = a.context.updateDoc = () => { throw new Error('Unexpected write'); };
    await a.run('initializeFirestore()');
    assert.match(a.elements.get('sync-status').textContent, /관리자 확인/);
});
