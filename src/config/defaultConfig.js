export let configFile = {
    template: '## Новые изменения\n\n$changes',
    groups: [
        {
            title: 'Новая функциональность',
            icon: ':sparkles:',
            version: 'minor',
            types: ['feat', 'feature']
        },
        {
            title: 'Исправление багов',
            icon: ':bug:',
            version: 'patch',
            types: ['fix', 'bugfix']
        },
        {
            title: 'Повышение производительности',
            icon: ':zap:',
            types: ['perf', 'optimize']
        },
        {
            title: 'Рефакторинг',
            icon: ':recycle:',
            types: ['refactor', 'code-clean']
        },
        {
            title: 'Тесты',
            icon: ':white_check_mark:',
            types: ['test', 'tests']
        },
        {
            title: 'Сборка системы',
            icon: ':construction_worker:',
            types: ['build', 'ci']
        },
        {
            title: 'Изменения в документации',
            icon: ':memo:',
            types: ['doc', 'docs']
        },
        {
            title: 'Изменения стиля кода',
            icon: ':art:',
            types: ['style']
        },
        {
            title: 'Рутина',
            icon: ':wrench:',
            types: ['chore']
        },
        {
            title: 'Остальные изменения',
            icon: ':flying_saucer:',
            types: ['other']
        },
        {
            title: 'Откат изменений',
            icon: ':x:',
            types: ['revert']
        }
    ],
    scopes: [
        {
            title: 'Репозиторий',
            icon: ':card_box:',
            types: ['repo']
        },
        {
            title: 'Обновление зависимостей',
            icon: ':chains:',
            types: ['deps']
        }
    ],
    skips: ['skip', 'skip-ci'],
    excludeTypes: []
};