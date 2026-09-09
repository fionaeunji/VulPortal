import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import security from "eslint-plugin-security";

// KISA 시큐어코딩 가이드 준수를 위해 eslint-plugin-security(권장 규칙)를 적용합니다.
// 경고 0건을 유지해야 하며, npm run lint 는 경고가 1건이라도 있으면 실패합니다.
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  security.configs.recommended,
  {
    rules: {
      // 코드오류 항목: any 사용 금지
      "@typescript-eslint/no-explicit-any": "error",
      // 코드오류 항목: 미사용 변수 금지 (밑줄로 시작하는 변수만 허용)
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // API 오용 항목: eval / new Function 금지
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
