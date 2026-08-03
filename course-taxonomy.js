// Authoritative classification for every top-level course folder in data.js.
// Course folder names are exact: do not infer a dance style from instructor names.
const COURSE_TAXONOMY = Object.freeze({
    categoryOrder: Object.freeze([
        'Salsa',
        'Bachata',
        'Zouk',
        'Kizomba',
        'Salsa Masterclass',
        'Kizomba Masterclass',
        'Other'
    ]),
    courseCategoryByFolder: Object.freeze({
        'Adolfo Indacochea  Tania Cannarsa - Salsa On2 Advanced': 'Salsa',
        'Adolfo Indacochea  Tania Cannarsa - Salsa On2 Beginner': 'Salsa',
        'Adolfo Indacochea  Tania Cannarsa - Salsa On2 Intermediate': 'Salsa',
        'Alex  Desirée - Advanced': 'Bachata',
        'Alex  Desirée - Beginner': 'Bachata',
        'Alex  Desirée - Intermediate': 'Bachata',
        'Arthur  Oksana - Zouk Advanced': 'Zouk',
        'Arthur  Oksana - Zouk Beginner': 'Zouk',
        'Arthur  Oksana - Zouk Beginner-Intermediate': 'Zouk',
        'Arthur  Oksana - Zouk Intermediate': 'Zouk',
        'Arthur  Oksana - Zouk Intermediate-Advanced': 'Zouk',
        'Carolina Rosa - Advanced': 'Bachata',
        'Carolina Rosa - Beginner': 'Bachata',
        'Carolina Rosa - Intermediate': 'Bachata',
        'Fernando Sosa  Tatiana Bonaguro - Sosa Style Advanced': 'Salsa',
        'Fernando Sosa  Tatiana Bonaguro - Sosa Style Beginner': 'Salsa',
        'Fernando Sosa  Tatiana Bonaguro - Sosa Style Intermediate': 'Salsa',
        'Fernando Sosa  Tatiana Bonaguro - Sosa Style On 2': 'Salsa',
        'Fernando Sosa  Tatiana Bonaguro - Sosa Style Upgrade': 'Salsa',
        'Isabelle  Felicien - Advanced': 'Kizomba',
        'Isabelle  Felicien - Beginner': 'Kizomba',
        'Isabelle  Felicien - Intermediate': 'Kizomba',
        'Kike  Nahir - Kike  Nahir Combinations': 'Bachata',
        'Kizomba Masterclass': 'Kizomba Masterclass',
        'Korke  Judith - Advanced': 'Bachata',
        'Korke  Judith - Bachata Sensual 2025 New Techniques and Cadences': 'Bachata',
        'Korke  Judith - BeginnerIntermediate': 'Bachata',
        'Korke  Judith - Fundamentals of Bachata Sensual': 'Bachata',
        'Korke  Judith - Intermediate  Advanced': 'Bachata',
        'Marco Espejo - Marco Espejo Style': 'Bachata',
        'Pablo  Raquel - Advanced': 'Bachata',
        'Pablo  Raquel - Intermediate': 'Bachata',
        'Pablo  Raquel - IntermediateAdvanced': 'Bachata',
        'Salsa Masterclass': 'Salsa Masterclass'
    })
});
