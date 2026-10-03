# Nguồn dữ liệu từ vựng

`vocabulary-data.json` kết hợp các nguồn sau:

1. **CEFR-J Vocabulary Profile 1.5**, nhóm nghiên cứu của Yukio Tono tại Tokyo University of Foreign Studies, và **Octanove Vocabulary Profile C1/C2 1.0**. Danh sách được lấy từ [Open Language Profiles](https://github.com/openlanguageprofiles/olp-en-cefrj). Dữ liệu CEFR-J yêu cầu dẫn nguồn; Octanove C1/C2 dùng giấy phép [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
2. Nghĩa tiếng Việt từ [thichhoc-dict](https://github.com/thichhoc-org/thichhoc-dict), dữ liệu theo [CC BY-SA 4.0](https://github.com/thichhoc-org/thichhoc-dict/blob/main/dict-en-vi/LICENSE-DATA). Nghĩa được tạo tự động và có thể chưa được người biên tập kiểm tra.
3. IPA chủ yếu từ thichhoc-dict; một số từ không có phiên âm ở nguồn này được bổ sung từ mục tương ứng trên [English Wiktionary](https://en.wiktionary.org/) theo [CC BY-SA 4.0](https://en.wiktionary.org/wiki/Wiktionary:Copyrights). Danh sách bổ sung nằm trong `ipa-fallbacks.json`, do script `scripts/build-ipa-fallbacks.mjs` trích từ mục English Pronunciation. IPA có thể khác theo giọng vùng miền.

Phần dữ liệu từ vựng kết hợp được phân phối theo **CC BY-SA 4.0**. Phần mã của SayBack được quản lý riêng. Khi dùng lại `vocabulary-data.json`, giữ ghi nguồn và điều kiện chia sẻ tương tự. Người học có thể sửa nghĩa và IPA trong trình duyệt; sửa đổi cá nhân đó chỉ nằm trên thiết bị của họ.
