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
                    },
                    {
                    "type": "text",
                    "text": "{{content}}",
                    "margin": "md"
                    }
                ]
                }
            };

const tpl_top = `{
                type: 'bubble',
                hero: {
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