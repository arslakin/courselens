/**
 * Realistic Turkish mock study content.
 *
 * Stands in for the future Bedrock (Nova) analysis. Deterministic and offline,
 * so the whole flow can be demoed without any backend. Content is written in
 * Turkish, grounded in a plausible lecture transcript.
 */
import type { Id, Quiz, QuizQuestion, StudySet } from "@rojanda/types";

let counter = 0;
export function mockId(prefix = "id"): Id {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}

/** A believable Turkish lecture transcript (photosynthesis / biyoloji). */
export const MOCK_TRANSCRIPT_TR =
  "Bugünkü derste fotosentez konusunu işledik. Fotosentez, bitkilerin güneş " +
  "ışığını kullanarak karbondioksit ve sudan besin (glikoz) ve oksijen " +
  "üretmesidir. Bu süreç kloroplast adı verilen organelde gerçekleşir ve " +
  "klorofil pigmenti ışığı soğurur. Fotosentezin iki ana evresi vardır: " +
  "ışığa bağımlı reaksiyonlar ve Calvin döngüsü. Işığa bağımlı reaksiyonlarda " +
  "su parçalanır ve oksijen açığa çıkar; ATP ve NADPH üretilir. Calvin " +
  "döngüsünde ise karbondioksit tutularak glikoz sentezlenir. Hoca, sınavda " +
  "ışığa bağımlı reaksiyonlar ile Calvin döngüsü arasındaki farkın önemli " +
  "olduğunu vurguladı.";

export function makeMockQuiz(): Quiz {
  const q = (
    prompt: string,
    options: [string, string, string, string],
    correctIndex: 0 | 1 | 2 | 3,
    explanation: string,
    difficulty: QuizQuestion["difficulty"],
    topic: string
  ): QuizQuestion => ({
    id: mockId("q"),
    prompt,
    options,
    correctIndex,
    explanation,
    difficulty,
    topic,
  });

  const questions: QuizQuestion[] = [
    q(
      "Fotosentez temel olarak neyi üretir?",
      ["Sadece su", "Glikoz ve oksijen", "Sadece karbondioksit", "Protein"],
      1,
      "Fotosentez, CO2 ve sudan glikoz ve oksijen üretir.",
      "easy",
      "Fotosentez temeli"
    ),
    q(
      "Fotosentez hangi organelde gerçekleşir?",
      ["Mitokondri", "Ribozom", "Kloroplast", "Çekirdek"],
      2,
      "Fotosentez kloroplastta gerçekleşir.",
      "easy",
      "Kloroplast"
    ),
    q(
      "Işığı soğuran pigmentin adı nedir?",
      ["Hemoglobin", "Klorofil", "Melanin", "Karoten"],
      1,
      "Klorofil ışığı soğuran temel pigmenttir.",
      "easy",
      "Klorofil"
    ),
    q(
      "Oksijen fotosentezin hangi evresinde açığa çıkar?",
      [
        "Calvin döngüsü",
        "Işığa bağımlı reaksiyonlar",
        "Glikoliz",
        "Krebs döngüsü",
      ],
      1,
      "Su, ışığa bağımlı reaksiyonlarda parçalanır ve oksijen açığa çıkar.",
      "medium",
      "Işığa bağımlı reaksiyonlar"
    ),
    q(
      "Calvin döngüsünde ne sentezlenir?",
      ["Oksijen", "ATP", "Glikoz", "Klorofil"],
      2,
      "Calvin döngüsünde karbondioksit tutularak glikoz sentezlenir.",
      "medium",
      "Calvin döngüsü"
    ),
    q(
      "Işığa bağımlı reaksiyonlarda üretilen enerji taşıyıcıları hangileridir?",
      ["ATP ve NADPH", "Sadece glikoz", "Sadece oksijen", "DNA ve RNA"],
      0,
      "Işığa bağımlı reaksiyonlar ATP ve NADPH üretir.",
      "medium",
      "Işığa bağımlı reaksiyonlar"
    ),
    q(
      "Fotosentez için gerekli olan ham maddeler nelerdir?",
      [
        "Glikoz ve oksijen",
        "Karbondioksit ve su",
        "Protein ve yağ",
        "Azot ve fosfor",
      ],
      1,
      "Fotosentez CO2 ve suyu ham madde olarak kullanır.",
      "medium",
      "Fotosentez temeli"
    ),
    q(
      "Calvin döngüsü ışığa doğrudan bağımlı mıdır?",
      [
        "Evet, ışık olmadan hiç çalışmaz",
        "Hayır; ışığa bağımlı reaksiyonların ürünlerini kullanır",
        "Sadece geceleri çalışır",
        "Işıkla hiçbir ilgisi yoktur",
      ],
      1,
      "Calvin döngüsü ışığa bağımlı reaksiyonların ürünü olan ATP/NADPH'yi kullanır.",
      "hard",
      "Calvin döngüsü"
    ),
    q(
      "Su moleküllerinin parçalanma sürecine ne ad verilir?",
      ["Fotoliz", "Hidroliz", "Fermantasyon", "Kondensasyon"],
      0,
      "Suyun ışıkla parçalanmasına fotoliz denir.",
      "hard",
      "Işığa bağımlı reaksiyonlar"
    ),
    q(
      "Sınav açısından hoca hangi ayrımın önemli olduğunu vurguladı?",
      [
        "Mitokondri ile ribozom",
        "Işığa bağımlı reaksiyonlar ile Calvin döngüsü",
        "DNA ile RNA",
        "Protein ile yağ",
      ],
      1,
      "Hoca, ışığa bağımlı reaksiyonlar ile Calvin döngüsü farkını vurguladı.",
      "hard",
      "Evreler arası fark"
    ),
  ];

  return { id: mockId("quiz"), questions };
}

export function makeMockStudySet(): StudySet {
  return {
    summary:
      "Bu derste fotosentez konusu işlendi. Fotosentez, bitkilerin güneş " +
      "ışığını kullanarak karbondioksit ve sudan glikoz ve oksijen ürettiği " +
      "süreçtir. Süreç kloroplastta gerçekleşir; klorofil ışığı soğurur. İki " +
      "ana evre vardır: ışığa bağımlı reaksiyonlar (su parçalanır, oksijen " +
      "açığa çıkar, ATP ve NADPH üretilir) ve Calvin döngüsü (CO2 tutularak " +
      "glikoz sentezlenir).",
    concepts: [
      {
        name: "Fotosentez",
        explanation: "Işık enerjisinin kimyasal enerjiye dönüştürülmesi süreci.",
        difficulty: "easy",
      },
      {
        name: "Kloroplast",
        explanation: "Fotosentezin gerçekleştiği organel.",
        difficulty: "easy",
      },
      {
        name: "Klorofil",
        explanation: "Işığı soğuran yeşil pigment.",
        difficulty: "easy",
      },
      {
        name: "Işığa bağımlı reaksiyonlar",
        explanation: "Suyun parçalandığı, ATP ve NADPH'nin üretildiği evre.",
        difficulty: "medium",
      },
      {
        name: "Calvin döngüsü",
        explanation: "Karbondioksitin tutularak glikoza dönüştürüldüğü evre.",
        difficulty: "medium",
      },
    ],
    explanations: [
      {
        concept: "Işığa bağımlı reaksiyonlar",
        plain:
          "Güneş ışığı kloroplasttaki klorofil tarafından yakalanır. Bu " +
          "enerjiyle su molekülleri parçalanır, oksijen havaya verilir ve " +
          "hücre için enerji taşıyan ATP ile NADPH üretilir.",
      },
      {
        concept: "Calvin döngüsü",
        plain:
          "Bu evrede ışık doğrudan gerekmez. Önceki evrede üretilen ATP ve " +
          "NADPH kullanılarak havadaki karbondioksit yakalanır ve şeker " +
          "(glikoz) yapımında kullanılır.",
      },
    ],
    flashcards: [
      { id: mockId("fc"), front: "Fotosentez nedir?", back: "Işık enerjisini kimyasal enerjiye çeviren süreç.", state: "unseen" },
      { id: mockId("fc"), front: "Fotosentez nerede olur?", back: "Kloroplastta.", state: "unseen" },
      { id: mockId("fc"), front: "Işığı hangi pigment soğurur?", back: "Klorofil.", state: "unseen" },
      { id: mockId("fc"), front: "Oksijen hangi evrede açığa çıkar?", back: "Işığa bağımlı reaksiyonlarda.", state: "unseen" },
      { id: mockId("fc"), front: "Calvin döngüsünde ne üretilir?", back: "Glikoz.", state: "unseen" },
      { id: mockId("fc"), front: "Işığa bağımlı evrede hangi enerji taşıyıcıları üretilir?", back: "ATP ve NADPH.", state: "unseen" },
    ],
    quiz: makeMockQuiz(),
    podcast: {
      id: mockId("pod"),
      script:
        "Merhaba! Bugünkü fotosentez dersini birlikte kısaca tekrar edelim. " +
        "Fotosentez, bitkilerin ışıkla besin ürettiği süreçtir ve " +
        "kloroplastta gerçekleşir. İki evreyi hatırla: ışığa bağımlı " +
        "reaksiyonlarda oksijen açığa çıkar; Calvin döngüsünde glikoz " +
        "üretilir. Sınavda bu iki evrenin farkına dikkat et. Başarılar!",
      durationSec: 75,
    },
  };
}
