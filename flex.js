const report_template = {  
    "type": "flex",
    "altText": "$header",
    "contents": {
        "type": "bubble",
        "hero": {
            "type": "image",
            "url": "{{img_url}}",
            "size": "full",
            "aspectRatio": "21:18",
            "aspectMode": "cover",
            "action": {
            "type": "uri",
            "uri": "http://linecorp.com/"
            }
        },
        "body": {
                "type": "box",
                "layout": "vertical",
                "spacing": "xs",
                "contents": [

                {
                    "type": "text",
                    "text": "{{header}}",
                    "weight": "bold",
                    "size": "md",
                    "align": "start"
                },
                {
                    "type": "text",
                    "text": "{{content}}",
                    "weight": "bold",
                    "size": "md",
                    "align": "start"
                }			
                    
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
  
  return JSON.parse(jsonString);
}

module.exports = {
  report_template,
  replacePlaceholders,
};