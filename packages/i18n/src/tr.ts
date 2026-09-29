/** Turkish string resources — the default locale for RojAnda. */
export const tr = {
  appName: "RojAnda",
  tagline: "Dersini kaydet, kaynaklarını yükle, öğrenmeye başla.",

  common: {
    save: "Kaydet",
    cancel: "Vazgeç",
    delete: "Sil",
    edit: "Düzenle",
    next: "İleri",
    previous: "Geri",
    done: "Bitti",
    retry: "Tekrar dene",
    loading: "Yükleniyor…",
    empty: "Henüz bir şey yok",
    errorTitle: "Bir sorun oluştu",
    close: "Kapat",
  },

  home: {
    title: "RojAnda",
    takePhoto: "Fotoğraf Çek",
    uploadSource: "Kaynak Yükle",
    recordLesson: "Dersi Kaydet",
    myCourses: "Derslerim",
    myNotes: "Notlarım",
    recentLessons: "Son Dersler",
    recentNotes: "Son Notlar",
    noRecentLessons: "Henüz ders kaydı yok",
    noRecentNotes: "Henüz not yok",
  },

  courses: {
    title: "Derslerim",
    newCourse: "Yeni Ders",
    courseName: "Ders adı",
    createCourse: "Ders oluştur",
    lessons: "Dersler",
    notes: "Notlar",
    noLessons: "Bu derste henüz kayıt yok",
    noCourses: "Henüz ders oluşturmadın",
    openCourse: "Dersi aç",
  },

  record: {
    title: "Dersi Kaydet",
    selectCourse: "Önce bir ders seç",
    start: "Kaydı başlat",
    pause: "Duraklat",
    resume: "Devam et",
    finish: "Bitir",
    recording: "Kaydediliyor…",
    paused: "Duraklatıldı",
    processing: "İşleniyor…",
    processingHint: "Ders metne dönüştürülüyor ve analiz ediliyor",
    ready: "Ders hazır",
    lessonTitle: "Ders başlığı",
    consentNote:
      "Kayıt yapmadan önce izin aldığından emin ol. Kayıtların yalnızca sana özeldir.",
  },

  study: {
    summary: "Ders Özeti",
    concepts: "Ana Kavramlar",
    explanations: "Açıklamalar",
    flashcards: "Flashcards",
    quiz: "Quiz",
    notes: "Notlarım",
    podcast: "Podcast",
    ask: "RojAnda'ya Sor",
    addToNotes: "Nota Ekle",
    added: "Eklendi ✓",
  },

  flashcards: {
    showAnswer: "Cevabı göster",
    known: "Anladım",
    review: "Tekrar Et",
    progress: (i: number, n: number) => `${i} / ${n}`,
  },

  quiz: {
    progress: (i: number, n: number) => `Soru ${i} / ${n}`,
    correct: "Doğru",
    incorrect: "Yanlış",
    correctAnswer: "Doğru cevap",
    finish: "Sonucu gör",
    scoreTitle: "Sonuç",
    scoreLine: (score: number, total: number) => `${score} / ${total} doğru`,
    percentage: (p: number) => `%${p}`,
    weakTopics: "Tekrar edilmesi gereken konular",
    reviewMistakes: "Hataları gözden geçir",
    retryIncorrect: "Yanlışları tekrar çöz",
    noMistakes: "Hiç hatan yok, tebrikler!",
  },

  notes: {
    title: "Notlarım",
    newNote: "Yeni Not",
    voiceNote: "Sesli Not",
    typeHere: "Notunu buraya yaz…",
    noteTitle: "Not başlığı (isteğe bağlı)",
    saved: "Kaydedildi",
    deleted: "Silindi",
    associatedCourse: "İlişkili ders",
    associatedLesson: "İlişkili ders kaydı",
    none: "Yok",
    voiceHint: "Konuş, notun otomatik olarak yazıya dökülsün",
    voiceRecording: "Dinleniyor…",
    voiceExample: "Örn: Hoca bu konunun sınavda önemli olduğunu söyledi.",
    transcribing: "Yazıya dökülüyor…",
  },

  podcast: {
    title: "Podcast",
    subtitle: "Bu dersi dinleyerek tekrar et.",
    play: "Dinle",
    pause: "Duraklat",
    placeholder: "Sesli özet yakında hazır olacak (demo).",
  },

  chat: {
    title: "RojAnda'ya Sor",
    placeholder: "Bu ders hakkında bir soru sor…",
    modeSources: "Ders Kaynaklarım",
    modeExternal: "Dış Kaynaklarda Ara",
    notFound: "Bu bilgi kaynaklarında yer almıyor.",
    externalDisabled: "Dış kaynak araması bu sürümde henüz aktif değil.",
    groundedLabel: "Kaynaklarından",
    externalLabel: "Dış kaynaklardan",
  },

  capture: {
    photoTitle: "Fotoğraf Çek",
    photoHint: "Ders materyalinin fotoğrafını çek (demo).",
    uploadTitle: "Kaynak Yükle",
    uploadHint: "PDF veya belge yükle (demo).",
    mockProcessed: "Örnek olarak işlendi (demo).",
  },
} as const;

export type Strings = typeof tr;
