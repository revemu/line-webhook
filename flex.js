const report_template = {
                "type": "bubble",
                hero: {
                    type: 'image',
                    url: '{{img_url}}',
                    size: 'full',
                    aspectRatio: '20:13',
                    aspectMode: 'cover'
                },
                "body": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {
                    "type": "text",
                    "text": "{{header}}",
                    "weight": "bold",
                    "size": "xl"
                    }
                ]
                }
            };

const tpl_top = 
`{
type: 'bubble',
hero: 
{
type: 'image',
url: '{{img_url}}',
size: 'full',
aspectRatio: '20:13',
aspectMode: 'cover'
},
body: {
type: 'box',
layout: 'vertical',
contents: [
{{content}}
]
}
}`;

const test =  {
    "type": "flex",
    "altText": "This is a Flex Message",
    "contents": {
                    type: 'bubble',
                    hero: {type: 'image',url: 'https://static.vecteezy.com/system/resources/thumbnails/028/142/355/small_2x/a-stadium-filled-with-excited-fans-a-football-field-in-the-foreground-background-with-empty-space-for-text-photo.jpg',
                    size: 'full',
                    aspectRatio: '20:13',
                    aspectMode: 'cover'
                    },
                    body: {
                      type: 'box',
                      layout: 'vertical',
                      contents: [
                        {type: 'text',text: 'SoccerBot',weight: 'bold',size: 'xl'}
                      ]
                    }
                }
  }

function replacePlaceholders(template, data) {
  let jsonString = JSON.stringify(template);
  
  // Replace all placeholders with actual data
  Object.keys(data).forEach(key => {
    const placeholder = `{{${key}}}`;
    const regex = new RegExp(placeholder, 'g');
    jsonString = jsonString.replace(regex, data[key]);
  });
  console.log(jsonString) ;
  return JSON.parse(jsonString);
}

function replaceFlex(template, data) {
  jsonString = template ;
  
  // Replace all placeholders with actual data
  Object.keys(data).forEach(key => {
    const placeholder = `{{${key}}}`;
    const regex = new RegExp(placeholder, 'g');
    jsonString = jsonString.replace(regex, data[key]);
  });
  
  return JSON.parse(jsonString);
}

module.exports = {
  report_template,
  tpl_top,
  replacePlaceholders,
  replaceFlex
};