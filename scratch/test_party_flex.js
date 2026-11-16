const flex = require('../flex');

const mockPartyData = {
  title: '🎉 งานเลี้ยงปีใหม่ (New Year Party 2026)',
  dateStr: 'เสาร์ที่ 19 ธ.ค. 2569',
  timeStr: '19:00 - 24:00 น.',
  venue: 'Waterside ห้องคาราโอกะ K5 Club Pool',
  note: '⚽ หลังจากเตะบอล 17:00-19:00 น.',
  heroUrl: 'https://bearbit.org/pic/party_header.jpg',
  members: [
    { name: 'Kyne', donate: '', nameColor: '#e11d48', badgeUrl: 'https://bearbit.org/pic/rank1.png', pictureUrl: 'https://profile.line-scdn.net/abc', isCurrent: true },
    { name: 'Somchai', donate: '', nameColor: '#0284c7', badgeUrl: null, pictureUrl: 'https://profile.line-scdn.net/def', isCurrent: false },
    { name: 'Somsak', donate: '', nameColor: null, badgeUrl: null, pictureUrl: null, isCurrent: false }
  ]
};

console.log('Testing buildPartyFlex (Dark Theme)...');
const darkFlex = flex.buildPartyFlex(mockPartyData, 'black');
console.log('Dark Flex type:', darkFlex.type, '| hero:', darkFlex.hero ? darkFlex.hero.url : 'none');
console.log('Body contents count:', darkFlex.body.contents.length);
console.log('Footer contents count:', darkFlex.footer.contents.length);

console.log('\nTesting buildPartyFlex (White Theme)...');
const whiteFlex = flex.buildPartyFlex(mockPartyData, 'white');
console.log('White Flex type:', whiteFlex.type);

console.log('\nTesting buildPartyFlex (Empty Members)...');
const emptyFlex = flex.buildPartyFlex({ ...mockPartyData, members: [] }, 'black');
console.log('Empty Flex type:', emptyFlex.type);

console.log('\n✅ All Party Flex tests passed successfully!');
process.exit(0);
